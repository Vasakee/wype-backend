import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateSelfCustodyMovementDto } from './dto/create-self-custody-movement.dto';
import { MovementService } from './movement.service';

@ApiTags('movement')
@ApiBearerAuth()
@Controller('movement')
@UseGuards(JwtAuthGuard)
export class MovementController {
  constructor(private readonly movementService: MovementService) {}

  @ApiOperation({
    summary:
      'Move funds from the custodial balance to the user’s self-custody wallet via Blip Pay',
  })
  @Post('self-custody')
  @HttpCode(HttpStatus.OK)
  moveToSelfCustody(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateSelfCustodyMovementDto,
  ) {
    return this.movementService.moveToSelfCustody(req.user.sub, dto);
  }

  @ApiOperation({ summary: 'Get the status of a self-custody movement' })
  @Get(':id')
  async status(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const movement = await this.movementService.findById(req.user.sub, id);
    if (!movement) {
      throw new NotFoundException('Movement not found');
    }
    return movement;
  }
}
