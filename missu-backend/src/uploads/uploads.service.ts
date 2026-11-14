/**
 * 사진 파일의 실제 형식과 크기를 검사하고 WebP로 다시 만들어 위치 등 메타데이터를 제거합니다.
 * 로컬 비공개 폴더에 저장하며, 사진 조회에는 5분만 유효한 서명 URL을 사용합니다.
 */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../integrations/storage.service';
import { equal, sign } from '../common/crypto';
import { fail } from '../common/http';

@Injectable()
export class UploadsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
  ) {}
  async upload(userId: string, file: Express.Multer.File | undefined) {
    if (!file) fail(400, 'VALIDATION_ERROR', '사진 파일이 필요합니다.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
      fail(415, 'FILE_TYPE_UNSUPPORTED', 'JPEG, PNG, WebP 사진만 지원합니다.');
    let output: Buffer;
    let width: number, height: number;
    try {
      const input = sharp(file.buffer, {
        limitInputPixels: 40000000,
        failOn: 'error',
      });
      const meta = await input.metadata();
      const acceptedFormats: Record<string, string> = {
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
      };
      const mime = acceptedFormats[meta.format ?? ''];
      if (mime !== file.mimetype || (meta.pages ?? 1) > 1)
        fail(415, 'FILE_TYPE_UNSUPPORTED', '사진 형식이 올바르지 않습니다.');
      const result = await input
        .rotate()
        .resize({
          width: 2000,
          height: 2000,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer({ resolveWithObject: true });
      output = result.data;
      width = result.info.width;
      height = result.info.height;
    } catch {
      fail(
        415,
        'FILE_TYPE_UNSUPPORTED',
        '사진을 읽을 수 없습니다. 올바른 사진 파일을 선택하세요.',
      );
    }
    const objectKey = randomUUID() + '.webp';
    await this.storage.put(objectKey, output);
    try {
      const photo = await this.db.itemPhoto.create({
        data: {
          uploaderId: userId,
          objectKey,
          mime: 'image/webp',
          byteSize: output.length,
          width,
          height,
        },
      });
      return { photoId: photo.id, state: photo.state };
    } catch (error) {
      await this.storage.remove(objectKey);
      throw error;
    }
  }
  url(id: string) {
    const expires = Math.floor(Date.now() / 1000) + 300;
    return `/api/v1/photos/${id}?expires=${expires}&signature=${sign(id + ':' + expires)}`;
  }
  async read(id: string, expires: string, signature: string, userId?: string) {
    if (
      !/^\d{10}$/.test(expires ?? '') ||
      !/^[a-f0-9]{64}$/.test(signature ?? '') ||
      +expires < Math.floor(Date.now() / 1000) ||
      +expires > Math.floor(Date.now() / 1000) + 300 ||
      !equal(sign(id + ':' + expires), signature)
    )
      fail(404, 'RESOURCE_NOT_FOUND', '사진을 찾을 수 없습니다.');
    const photo = await this.db.itemPhoto.findUnique({
      where: { id },
      select: {
        objectKey: true,
        uploaderId: true,
        itemId: true,
        item: { select: { archived: true } },
      },
    });
    if (
      !photo ||
      photo.item?.archived ||
      (!photo.itemId && photo.uploaderId !== userId)
    )
      fail(404, 'RESOURCE_NOT_FOUND', '사진을 찾을 수 없습니다.');
    return this.storage.get(photo.objectKey);
  }
}
