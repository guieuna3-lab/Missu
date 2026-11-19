import {
  Controller,
  Get,
  Injectable,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import sharp from 'sharp';
import { Public } from '../auth/auth.guard';
import type { SessionRequest } from '../auth/session.service';
import { fail } from '../common/http';
import { RateLimitService } from '../common/rate-limit.service';
import { ExternalHttpService } from '../integrations/external-http.service';
import { InstitutionItemsService } from './institution-items.service';
import { schoolArticle } from './institution-records';

const MAX_BYTES = 10 * 1024 * 1024;
const CACHE_BYTES = 16 * 1024 * 1024;
const CACHE_MS = 10 * 60_000;
type PhotoSet = { full: Buffer; thumb: Buffer };

/** 학교 다운로드 파일은 HTML 오류/다운로드 MIME으로 올 수 있어 실제 사진인지 검증합니다. */
@Injectable()
export class InstitutionPhotosService {
  private readonly cache = new Map<
    string,
    { until: number; bytes: number; value: Promise<PhotoSet> }
  >();
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(
    private readonly items: InstitutionItemsService,
    private readonly http: ExternalHttpService,
  ) {}

  async image(id: string, index: string, size?: string) {
    if (!/^hansung:\d{1,12}$/.test(id) || !/^[0-7]$/.test(index))
      return fail(404, 'RESOURCE_NOT_FOUND', '사진을 찾을 수 없어요.');
    if (size !== undefined && size !== 'thumb')
      return fail(400, 'VALIDATION_ERROR', '사진 크기를 확인해 주세요.');
    const variant = size === 'thumb' ? 'thumb' : 'full';
    const key = id + ':' + index;
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) {
      // 최근 본 사진을 우선 남기고, 목록과 상세가 원본 요청을 공유합니다.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return (await cached.value)[variant];
    }
    const value = this.queued(() => this.read(id, Number(index)));
    const entry = { until: Infinity, bytes: 0, value };
    this.cache.set(key, entry);
    this.trim();
    void value.then(
      (photos) => {
        entry.bytes = photos.full.length + photos.thumb.length;
        entry.until = Date.now() + CACHE_MS;
        this.trim();
      },
      () => {},
    );
    void value.catch(() => {
      if (this.cache.get(key)?.value === value) this.cache.delete(key);
    });
    return (await value)[variant];
  }

  private trim() {
    for (const [key, entry] of this.cache)
      if (entry.until <= Date.now()) this.cache.delete(key);
    let bytes = [...this.cache.values()].reduce(
      (sum, entry) => sum + entry.bytes,
      0,
    );
    for (const [key, entry] of this.cache) {
      if (this.cache.size <= 48 && bytes <= CACHE_BYTES) break;
      this.cache.delete(key);
      bytes -= entry.bytes;
    }
  }

  private async queued(work: () => Promise<PhotoSet>) {
    if (this.active >= 2)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await work();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  private async read(id: string, index: number) {
    const item = await this.items.detail(id);
    const address = item.photoUrls?.[index];
    if (!address)
      return fail(404, 'RESOURCE_NOT_FOUND', '공개된 사진이 없어요.');
    // 사용자에게 URL을 받지 않고, 실제 게시글에서 확인한 학교 사진만 요청합니다.
    const url = new URL(address);
    if (
      url.origin !== 'https://www.hansung.ac.kr' ||
      url.username ||
      url.password ||
      !(
        /^\/bbs\/hansung\/2175\/\d+\/download\.do$/.test(url.pathname) ||
        /\.(?:jpe?g|png|gif|webp|avif)$/i.test(url.pathname)
      )
    )
      return fail(404, 'RESOURCE_NOT_FOUND', '사진 주소를 확인할 수 없어요.');
    try {
      const response = await this.http.request(url.href, {
        headers: { Referer: schoolArticle(id.slice(8)) },
        signal: AbortSignal.timeout(10_000),
      });
      if (Number(response.headers.get('content-length')) > MAX_BYTES)
        throw new Error('Image too large');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty photo');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > MAX_BYTES) throw new Error('Image too large');
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel();
      }
      // HTML, SVG, 잘못된 다운로드 파일을 그대로 브라우저에 전달하지 않습니다.
      const input = Buffer.concat(chunks);
      const metadata = await sharp(input, {
        limitInputPixels: 24_000_000,
      }).metadata();
      if (
        !metadata.format ||
        !['jpeg', 'png', 'webp', 'gif', 'avif', 'heif'].includes(
          metadata.format,
        )
      )
        throw new Error('Not a raster photo');
      const image = sharp(input, { limitInputPixels: 24_000_000 }).rotate();
      const [full, thumb] = await Promise.all(
        [1600, 240].map((edge) =>
          image
            .clone()
            .resize({
              width: edge,
              height: edge,
              fit: 'inside',
              withoutEnlargement: true,
            })
            .webp({ quality: edge === 240 ? 72 : 82 })
            .toBuffer(),
        ),
      );
      return { full, thumb };
    } catch {
      return fail(
        503,
        'EXTERNAL_UNAVAILABLE',
        '원본 사진을 잠시 불러올 수 없어요.',
      );
    }
  }
}

@Public()
@Controller('api/v1/institution-items')
export class InstitutionPhotosController {
  constructor(
    private readonly photos: InstitutionPhotosService,
    private readonly rates: RateLimitService,
  ) {}
  @Get('image/:id/:index')
  async image(
    @Param('id') id: string,
    @Param('index') index: string,
    @Query('size') size: string | undefined,
    @Req() req: SessionRequest,
    @Res() res: Response,
  ) {
    await this.rates.consume('institution-image:' + req.ip, 180, 60_000);
    const bytes = await this.photos.image(id, index, size);
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.type('image/webp').send(bytes);
  }
}
