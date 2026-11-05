/** 정제한 사진의 저장 위치를 분리합니다. 외부 URL을 사용자 입력으로 받아 다운로드하지 않습니다. */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from '../config';
import { ExternalHttpService } from './external-http.service';
import { fail } from '../common/http';

@Injectable()
export class StorageService implements OnModuleInit {
  constructor(private readonly http: ExternalHttpService) {}
  async onModuleInit() {
    const settings = config();
    if (settings.storageProvider !== 'supabase') return;
    const response = await this.http.request(
      settings.supabaseUrl +
        '/storage/v1/bucket/' +
        encodeURIComponent(settings.supabaseBucket!),
      {
        headers: {
          Authorization: 'Bearer ' + settings.supabaseKey,
          apikey: settings.supabaseKey!,
        },
      },
    );
    const bucket = (await response.json()) as { id?: string; public?: boolean };
    if (bucket.id !== settings.supabaseBucket || bucket.public !== false)
      throw new Error('Supabase 사진 버킷은 비공개로 구성해야 합니다.');
  }
  private remote(key: string) {
    if (!/^[a-f0-9-]{36}\.webp$/.test(key))
      throw new Error('Invalid storage key');
    const settings = config();
    return {
      url:
        settings.supabaseUrl +
        '/storage/v1/object/' +
        encodeURIComponent(settings.supabaseBucket!) +
        '/' +
        key,
      headers: {
        Authorization: 'Bearer ' + settings.supabaseKey,
        apikey: settings.supabaseKey!,
      },
    };
  }
  async put(key: string, data: Buffer) {
    if (config().storageProvider === 'local') {
      await mkdir(config().storagePath, { recursive: true });
      await writeFile(resolve(config().storagePath, key), data, { flag: 'wx' });
    } else {
      const remote = this.remote(key);
      await this.http.request(remote.url, {
        method: 'POST',
        headers: {
          ...remote.headers,
          'Content-Type': 'image/webp',
          'x-upsert': 'false',
        },
        body: new Uint8Array(data),
      });
    }
  }
  async get(key: string) {
    if (config().storageProvider === 'local') {
      try {
        return await readFile(resolve(config().storagePath, key));
      } catch {
        fail(404, 'RESOURCE_NOT_FOUND', '사진을 찾을 수 없습니다.');
      }
    }
    const remote = this.remote(key);
    const response = await this.http.request(
      remote.url.replace(
        '/storage/v1/object/',
        '/storage/v1/object/authenticated/',
      ),
      { headers: remote.headers },
    );
    return Buffer.from(await response.arrayBuffer());
  }
  async remove(key: string) {
    if (config().storageProvider === 'local') {
      await unlink(resolve(config().storagePath, key)).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        },
      );
    } else {
      const settings = config();
      const remote = this.remote(key);
      await this.http.request(
        settings.supabaseUrl +
          '/storage/v1/object/' +
          encodeURIComponent(settings.supabaseBucket!),
        {
          method: 'DELETE',
          headers: { ...remote.headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: [key] }),
        },
      );
    }
  }
}
