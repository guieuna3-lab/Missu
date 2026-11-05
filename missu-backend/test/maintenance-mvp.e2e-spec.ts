import { randomUUID } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MaintenanceService } from '../src/maintenance/maintenance.service';
import { harness, type Harness } from './mvp-support';
describe('만료 데이터 정리', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  }, 30000);
  afterAll(async () => {
    await h?.close();
  });
  it('미리보기는 보존하고 실행은 오래된 미연결 사진만 정리한다', async () => {
    const user = await h.user('cleanup'),
      item = await h.item(user);
    const old = new Date(Date.now() - 2 * 86400000);
    await mkdir(process.env.STORAGE_PATH!, { recursive: true });
    const photo = async (attached: boolean, date: Date) => {
      const key = randomUUID() + '.webp';
      await writeFile(
        resolve(process.env.STORAGE_PATH!, key),
        Buffer.from('synthetic'),
      );
      return h.db.itemPhoto.create({
        data: {
          uploaderId: user.id,
          objectKey: key,
          mime: 'image/webp',
          byteSize: 9,
          width: 1,
          height: 1,
          createdAt: date,
          ...(attached
            ? { itemId: item.id, state: 'ATTACHED', sortOrder: 0 }
            : {}),
        },
      });
    };
    const expired = await photo(false, old),
      recent = await photo(false, new Date()),
      attached = await photo(true, old);
    const service = h.app.get(MaintenanceService);
    const preview = await service.run(false);
    expect(preview.temporaryPhotos).toBeGreaterThanOrEqual(1);
    await access(resolve(process.env.STORAGE_PATH!, expired.objectKey));
    const result = await service.run(true);
    expect(result.photosDeleted).toBeGreaterThanOrEqual(1);
    expect(
      await h.db.itemPhoto.findUnique({ where: { id: expired.id } }),
    ).toBeNull();
    await expect(
      access(resolve(process.env.STORAGE_PATH!, expired.objectKey)),
    ).rejects.toThrow();
    await access(resolve(process.env.STORAGE_PATH!, recent.objectKey));
    await access(resolve(process.env.STORAGE_PATH!, attached.objectKey));
    expect(
      await h.db.user.findUnique({ where: { id: user.id } }),
    ).not.toBeNull();
  });
});
