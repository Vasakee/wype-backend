import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransferService } from './transfer.service';

@Controller('transfers')
@UseGuards(JwtAuthGuard)
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateTransferDto) {
    return this.transferService.create(req.user.sub, dto);
  }

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.transferService.findByUser(req.user.sub);
  }
}
