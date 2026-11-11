/**
 * 사진 업로드와 조회 주소입니다. 파일을 올릴 때는 로그인과 CSRF 검사를 통과해야 합니다.
 * 업로드한 사진은 본인 물품 등록에 한 번만 연결할 수 있습니다.
 */
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Public } from '../auth/auth.guard';
import type { SessionRequest } from '../auth/session.service';
import { UploadsService } from './uploads.service';
import { ApiBody, ApiConsumes, ApiHeader } from '@nestjs/swagger';

@Controller('api/v1')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}
  @Post('uploads')
  @ApiConsumes('multipart/form-data')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: SessionRequest,
  ) {
    return { data: await this.uploads.upload(req.authSession!.userId!, file) };
  }
  @Public()
  @Get('photos/:id')
  async photo(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Req() req: SessionRequest,
    @Res() res: Response,
  ) {
    const image = await this.uploads.read(
      id,
      expires,
      signature,
      req.authSession?.userId ?? undefined,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.type('image/webp').send(image);
  }
}
