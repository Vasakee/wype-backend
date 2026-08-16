import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { AcceptRequestDto } from './dto/accept-request.dto';
import { CreateRequestDto } from './dto/create-request.dto';
import { RequestService } from './request.service';

@ApiTags('request')
@ApiBearerAuth()
@Controller('request')
@UseGuards(JwtAuthGuard)
export class RequestController {
  constructor(private readonly requestService: RequestService) {}

  @ApiOperation({
    summary: 'Request money from another Wype user by email',
  })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateRequestDto) {
    return this.requestService.create(req.user.sub, dto);
  }

  @ApiOperation({
    summary: 'List outgoing and incoming money requests',
  })
  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.requestService.list(req.user.sub);
  }

  @ApiOperation({
    summary: 'Accept a money request — sends QUAI to the requester',
  })
  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  accept(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: AcceptRequestDto,
  ) {
    return this.requestService.accept(req.user.sub, id, dto.pin);
  }

  @ApiOperation({ summary: 'Decline a money request' })
  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  decline(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.requestService.decline(req.user.sub, id);
  }
}
