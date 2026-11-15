/**
 * 물품 저장과 조회의 실제 업무 규칙을 처리합니다.
 * 공개 조회는 정해진 필드만 선택하고, 비공개 특징은 보관자의 관리 상세에서만 복원합니다.
 */
import { itemSearch, publicFoundWhere } from './item-search';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Prisma } from '../generated/prisma/client';
import { UploadsService } from '../uploads/uploads.service';
import { IdempotencyService } from '../common/idempotency.service';
import { decrypt, encrypt } from '../common/crypto';
import { fail } from '../common/http';
import { transaction } from '../common/transaction';
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
// 앱의 상세 분류가 공개 검색의 분류와 일치하도록 등록과 수정에서 함께 변환합니다.
function publicCategory(dto: CreateItemDto) {
  if (!dto.appCategory) return dto.category;
  if (dto.appCategory === 'WALLET' || dto.appCategory === 'BAG')
    return 'WALLET_BAG';
  return dto.appCategory === 'ELECTRONICS' ? 'ELECTRONICS' : 'OTHER';
}

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
    const where = publicFoundWhere(itemSearch(query.q, query.place), from, to);
    const [rows, total] = await Promise.all([
      this.db.foundItem.findMany({
        where: cursor
          ? { ...where, AND: [...where.AND, olderThan(cursor)] }
          : where,
        select: publicSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
      // 첫 검색의 총건수는 다음 페이지 커서나 표시 개수의 영향을 받지 않습니다.
      !cursor && query.q ? this.db.foundItem.count({ where }) : undefined,
    ]);
    const hasMore = rows.length > query.limit,
      page = rows.slice(0, query.limit),
      last = page.at(-1);
    return {
      data: page.map((x) => this.publicDto(x)),
      meta: {
        total,
        nextCursor:
          hasMore && last ? cursorFor(last.id, last.createdAt, scope) : null,
      },
    };
  }
  async detail(id: string) {
    const item = await this.db.foundItem.findUnique({
      where: { id, archived: false },
      select: publicSelect,
    });
    if (!item) fail(404, 'RESOURCE_NOT_FOUND', '물품을 찾을 수 없습니다.');
    return this.publicDto(item);
  }
  async manage(id: string, userId: string) {
    const item = await this.db.foundItem.findFirst({
      where: { id, keeperId: userId, archived: false },
      select: {
        ...publicSelect,
        appCategory: true,
        secret: { select: { featuresCiphertext: true } },
      },
    });
    if (!item) fail(404, 'RESOURCE_NOT_FOUND', '물품을 찾을 수 없습니다.');
    return {
      ...this.publicDto(item),
      appCategory: item.appCategory,
      privateFeatures: item.secret
        ? decrypt(item.secret.featuresCiphertext)
        : null,
    };
  }
  async remove(id: string, userId: string, requestId: string) {
    await transaction(this.db, async (tx) => {
      // 승인·전달과 같은 물품 행을 잠가, 반환이 진행되는 도중에 글이 사라지는 것을 막습니다.
      const [item] = await tx.$queryRaw<
        { status: string }[]
      >`SELECT status FROM found_items WHERE id=${id}::uuid AND keeper_id=${userId}::uuid AND NOT archived FOR UPDATE`;
      if (!item) fail(404, 'RESOURCE_NOT_FOUND', '물품을 찾을 수 없습니다.');
      if (item.status === 'RESERVED')
        fail(
          409,
          'RETURN_IN_PROGRESS',
          '반환 중인 물품은 수령 확인이 끝난 뒤 삭제할 수 있어요.',
        );
      await tx.foundItem.update({ where: { id }, data: { archived: true } });
      await tx.claim.updateMany({
        where: { itemId: id, status: 'PENDING' },
        data: {
          status: 'CLOSED',
          decisionReason: '보관자가 습득물 글을 삭제했어요.',
        },
      });
      await tx.auditEvent.create({
        data: {
          actorId: userId,
          entityType: 'found_items',
          entityId: id,
          action: 'ITEM_DELETED',
          requestId,
        },
      });
    });
  }
  async edit(
    id: string,
    userId: string,
    dto: CreateItemDto,
    requestId: string,
  ) {
    const foundAt = validTime(dto.foundAt);
    await transaction(this.db, async (tx) => {
      const locks = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM found_items WHERE id=${id}::uuid AND keeper_id=${userId}::uuid AND NOT archived FOR UPDATE`;
      if (!locks.length)
        fail(404, 'RESOURCE_NOT_FOUND', '물품을 찾을 수 없습니다.');
      const existing = await tx.itemPhoto.findMany({
        where: { itemId: id },
        select: { id: true },
      });
      const attached = new Set(existing.map((p) => p.id));
      // 순서를 재배치할 때 잠시 연결을 해제합니다. 오류가 발생하면 사진과 물품이 함께 롤백됩니다.
      await tx.itemPhoto.updateMany({
        where: { itemId: id },
        data: { state: 'READY', itemId: null, sortOrder: null },
      });
      for (const photoId of [...dto.photoIds].sort()) {
        const { count } = await tx.itemPhoto.updateMany({
          where: {
            id: photoId,
            uploaderId: userId,
            state: 'READY',
            itemId: null,
            ...(attached.has(photoId)
              ? {}
              : { createdAt: { gte: new Date(Date.now() - 86400000) } }),
          },
          data: {
            state: 'ATTACHED',
            itemId: id,
            sortOrder: dto.photoIds.indexOf(photoId),
          },
        });
        if (count !== 1)
          fail(
            409,
            'PHOTO_UNAVAILABLE',
            '본인 물품의 사진이나 새로 올린 사진을 선택하세요.',
          );
      }
      await tx.foundItem.update({
        where: { id },
        data: {
          name: dto.name,
          category: publicCategory(dto),
          appCategory: dto.appCategory,
          foundAt,
          foundLabel: dto.foundLocation.label,
          lat: dto.foundLocation.lat,
          lng: dto.foundLocation.lng,
          storagePlace: dto.storagePlace,
          pickupGuide: dto.pickupGuide,
          publicFeatures: dto.publicFeatures,
        },
      });
      if (dto.privateFeatures !== undefined) {
        if (dto.privateFeatures) {
          const value = { featuresCiphertext: encrypt(dto.privateFeatures) };
          await tx.foundItemSecret.upsert({
            where: { itemId: id },
            create: { itemId: id, ...value },
            update: value,
          });
        } else await tx.foundItemSecret.deleteMany({ where: { itemId: id } });
      }
      await tx.auditEvent.create({
        data: {
          actorId: userId,
          entityType: 'found_items',
          entityId: id,
          action: 'ITEM_UPDATED',
          requestId,
        },
      });
    });
    return this.manage(id, userId);
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
          category: publicCategory(dto),
          appCategory: dto.appCategory,
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
