import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { SessionRequest } from '../auth/session.service';
import { DatabaseService } from '../database/database.service';
import { fail } from '../common/http';

const keeper = '81bf8eb6-7551-4f18-bfb3-259f50ed8533';
const requester = '0a03faa3-630d-4c59-8e1f-024d450abb3e';
function roleOf(id: string) {
  if (id === keeper) return 'keeper' as const;
  if (id === requester) return 'requester' as const;
  return fail(
    403,
    'DEMO_ONLY',
    '팀에 전달된 한성대 시연 계정으로 로그인해 주세요.',
  );
}
const steps = {
  approve: ['keeper', 'PENDING', 'APPROVED'],
  reject: ['keeper', 'PENDING', 'REJECTED'],
  handover: ['keeper', 'APPROVED', 'HANDED_OVER'],
  receive: ['requester', 'HANDED_OVER', 'RETURNED'],
} as const;

@Controller('api/v1/hansung-demo')
export class HansungDemoController {
  constructor(private readonly db: DatabaseService) {}
  @Get()
  async current(@Req() req: SessionRequest) {
    const role = roleOf(req.authSession!.userId!);
    const request = await this.db.hansungDemoRequest.findFirst({
      where: { requesterId: requester },
      select: { id: true, status: true, updatedAt: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    return { data: { role, request } };
  }
  @Post()
  async create(@Req() req: SessionRequest) {
    if (roleOf(req.authSession!.userId!) !== 'requester')
      fail(403, 'DEMO_ROLE', '요청자 시연 계정으로 시작하세요.');
    // 진행 중 요청은 하나만 유지합니다. 수령·거절 후에는 다음 팀원이 다시 시작할 수 있습니다.
    await this.db
      .$executeRaw`INSERT INTO hansung_demo_requests(id,requester_id,status)
      VALUES (${randomUUID()}::uuid,${requester}::uuid,'PENDING')
      ON CONFLICT (requester_id) WHERE status IN ('PENDING','APPROVED','HANDED_OVER') DO NOTHING`;
    return this.current(req);
  }
  @Post(':id/:action')
  async change(
    @Req() req: SessionRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action') action: string,
  ) {
    const role = roleOf(req.authSession!.userId!);
    if (!Object.hasOwn(steps, action))
      fail(400, 'INVALID_ACTION', '지원하지 않는 동작이에요.');
    const [allowed, from, to] = steps[action as keyof typeof steps];
    if (role !== allowed)
      fail(
        403,
        'DEMO_ROLE',
        '이 단계를 진행할 수 있는 시연 계정으로 로그인하세요.',
      );
    const update = await this.db.hansungDemoRequest.updateMany({
      where: { id, requesterId: requester, status: from },
      data: { status: to, updatedAt: new Date() },
    });
    if (!update.count)
      fail(409, 'STATE_CHANGED', '진행 상태가 바뀌었어요. 새로고침해 주세요.');
    return this.current(req);
  }
}
