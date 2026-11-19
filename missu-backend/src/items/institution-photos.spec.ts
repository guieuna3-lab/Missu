import sharp from 'sharp';
import { InstitutionPhotosService } from './institution-photos.controller';
import type { InstitutionItemsService } from './institution-items.service';
import type { ExternalHttpService } from '../integrations/external-http.service';

const address = 'https://www.hansung.ac.kr/bbs/hansung/2175/64643/download.do';
function setup(request: jest.Mock, photoUrls = [address]) {
  const detail = jest.fn().mockResolvedValue({ photoUrls });
  const service = new InstitutionPhotosService(
    { detail } as unknown as InstitutionItemsService,
    { request } as unknown as ExternalHttpService,
  );
  return { service, detail };
}
describe('학교 공개 사진 전달', () => {
  it('다운로드 MIME 사진을 게시글 출처로 요청하고 실제 WebP로 변환·재사용한다', async () => {
    const input = await sharp({
      create: { width: 20, height: 10, channels: 3, background: '#345678' },
    })
      .jpeg()
      .toBuffer();
    const request = jest
      .fn()
      .mockImplementation(
        async () =>
          new Response(new Uint8Array(input), {
            headers: { 'Content-Type': 'application/x-msdownload' },
          }),
      );
    const { service } = setup(request);
    const [a, b] = await Promise.all([
      service.image('hansung:226144', '0'),
      service.image('hansung:226144', '0'),
    ]);
    expect((await sharp(a).metadata()).format).toBe('webp');
    expect(a).toEqual(b);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1].headers.Referer).toBe(
      'https://www.hansung.ac.kr/bbs/hansung/2175/226144/artclView.do',
    );
  });
  it('200 HTML 오류를 사진으로 보내지 않고 다음 재시도는 다시 요청한다', async () => {
    const request = jest
      .fn()
      .mockImplementation(
        async () => new Response('<html>Request Rejected</html>'),
      );
    const { service } = setup(request);
    await expect(service.image('hansung:226144', '0')).rejects.toThrow(
      '원본 사진',
    );
    await expect(service.image('hansung:226144', '0')).rejects.toThrow(
      '원본 사진',
    );
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('외부 주소와 잘못된 ID·순번은 원본 서버에 요청하지 않는다', async () => {
    const request = jest.fn();
    const { service } = setup(request, ['https://example.org/a.jpg']);
    await expect(service.image('hansung:1', '0')).rejects.toThrow('사진 주소');
    await expect(service.image('http://localhost', '0')).rejects.toThrow(
      '사진을',
    );
    await expect(service.image('hansung:1', '8')).rejects.toThrow('사진을');
    expect(request).not.toHaveBeenCalled();
  });
  it('과대 파일과 공개 사진 없는 물품을 거절한다', async () => {
    const request = jest
      .fn()
      .mockResolvedValue(
        new Response('too large', {
          headers: { 'content-length': String(11 * 1024 * 1024) },
        }),
      );
    await expect(
      setup(request).service.image('hansung:1', '0'),
    ).rejects.toThrow('원본 사진');
    await expect(
      setup(request, []).service.image('hansung:1', '0'),
    ).rejects.toThrow('공개된 사진');
  });
});
