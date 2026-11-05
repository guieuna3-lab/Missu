/**
 * 물품 저장과 조회의 실제 업무 규칙을 처리합니다.
 * 공개 조회는 정해진 필드만 선택하고, 비공개 특징은 보관자의 관리 상세에서만 복원합니다.
 */
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Prisma } from '../generated/prisma/client';
import { UploadsService } from '../uploads/uploads.service';
import { IdempotencyService } from '../common/idempotency.service';
import { decrypt, encrypt } from '../common/crypto';
import { fail } from '../common/http';
import { validTime } from '../common/dto';
import { cursorFor, olderThan, readCursor } from '../common/cursor';
import { CreateItemDto, SearchItemsDto } from './items.dto';

export const publicSelect = {
  id: true,
  name: true,
  category: true,
  publicFeatures: true,
  foundAt: true,
  foundLabel: true,
  lat: true,
  lng: true,
  storagePlace: true,
  pickupGuide: true,
  status: true,
  createdAt: true,
  photos: { select: { id: true }, orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.FoundItemSelect;
type PublicRow = Prisma.FoundItemGetPayload<{ select: typeof publicSelect }>;
const literal = (text: string) => text.replace(/[\\%_]/g, '\\$&');

@Injectable()
export class ItemsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly uploads: UploadsService,
    private readonly idem: IdempotencyService,
  ) {}
  publicDto(row: PublicRow) {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      publicFeatures: row.publicFeatures,
      foundAt: row.foundAt,
      foundLocation: {
        label: row.foundLabel,
        lat: Number(row.lat),
        lng: Number(row.lng),
      },
      photos: row.photos.map((photo) => ({
        id: photo.id,
        url: this.uploads.url(photo.id),
      })),
      storagePlace: row.storagePlace,
      pickupGuide: row.pickupGuide,
      status: row.status,
      createdAt: row.createdAt,
    };
  }
  async search(query: SearchItemsDto) {
    const scope = JSON.stringify([
      'items',
      query.q ?? '',
      query.place ?? '',
      query.foundFrom ?? '',
      query.foundTo ?? '',
    ]);
    const cursor = readCursor(query.cursor, scope);
    const from = query.foundFrom ? validTime(query.foundFrom) : undefined;
    const to = query.foundTo ? validTime(query.foundTo) : undefined;
    if (from && to && from > to)
      fail(
        400,
        'VALIDATION_ERROR',
        '검색 시작일은 종료일보다 늦을 수 없습니다.',
      );
    const where: Prisma.FoundItemWhereInput = {
      status: { in: ['AVAILABLE', 'RESERVED'] },
      ...(query.q
        ? {
            OR: [
              { name: { contains: literal(query.q), mode: 'insensitive' } },
              {
                publicFeatures: {
                  contains: literal(query.q),
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
      ...(query.place
        ? {
            foundLabel: { contains: literal(query.place), mode: 'insensitive' },
          }
        : {}),
      ...(from || to ? { foundAt: { gte: from, lte: to } } : {}),
      AND: olderThan(cursor),
    };
    const rows = await this.db.foundItem.findMany({
      where,
      select: publicSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit,
      page = rows.slice(0, query.limit),
      last = page.at(-1);
    return {
      data: page.map((x) => this.publicDto(x)),
      meta: {
        nextCursor:
          hasMore && last ? cursorFor(last.id, last.createdAt, scope) : null,
      },
    };
  }
  async detail(id: string) {
    const item = await this.db.foundItem.findUnique({
      where: { id },
      select: publicSelect,
    });
    if (!item) fail(404, 'RESOURCE_NOT_FOUND', '물품을 찾을 수 없습니다.');
    return this.publicDto(item);
  }
  async manage(id: string, userId: string) {
    const item = await this.db.foundItem.findFirst({
      where: { id, keeperId: userId },
      select: {
        ...publicSelect,
        secret: { select: { featuresCiphertext: true } },
      },
    });
    if (!item) fail(404, 'RESOURCE_NOT_FOUND', '물품을 찾을 수 없습니다.');
    return {
      ...this.publicDto(item),
      privateFeatures: item.secret
        ? decrypt(item.secret.featuresCiphertext)
        : null,
    };
  }
  create(
    dto: CreateItemDto,
    userId: string,
    key: string | undefined,
    requestId: string,
  ) {
    const foundAt = validTime(dto.foundAt);
    return this.idem.run(userId, 'POST /items', key, dto, async (tx) => {
      const item = await tx.foundItem.create({
        data: {
          keeperId: userId,
          name: dto.name,
          category: dto.category ?? undefined,
          publicFeatures: dto.publicFeatures,
          foundAt,
          foundLabel: dto.foundLocation.label,
          lat: dto.foundLocation.lat,
          lng: dto.foundLocation.lng,
          storagePlace: dto.storagePlace,
          pickupGuide: dto.pickupGuide,
          ...(dto.privateFeatures
            ? {
                secret: {
                  create: { featuresCiphertext: encrypt(dto.privateFeatures) },
                },
              }
            : {}),
        },
      });
      // 아직 연결되지 않은 본인 사진만 변경하므로 동시 등록에서도 사진 재사용을 막습니다.
      for (const photoId of [...dto.photoIds].sort()) {
        const result = await tx.itemPhoto.updateMany({
          where: {
            id: photoId,
            uploaderId: userId,
            itemId: null,
            state: 'READY',
            createdAt: { gte: new Date(Date.now() - 86400000) },
          },
          data: {
            itemId: item.id,
            state: 'ATTACHED',
            sortOrder: dto.photoIds.indexOf(photoId),
          },
        });
        if (result.count !== 1)
          fail(
            409,
            'PHOTO_UNAVAILABLE',
            '본인이 올린 미사용 사진을 선택하세요.',
          );
      }
      await tx.auditEvent.create({
        data: {
          actorId: userId,
          action: 'ITEM_CREATED',
          entityType: 'found_items',
          entityId: item.id,
          requestId,
        },
      });
      return { id: item.id, status: item.status };
    });
  }
}
