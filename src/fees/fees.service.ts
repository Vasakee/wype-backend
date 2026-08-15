import { Injectable } from '@nestjs/common';

const FEE_RATE = 0.005; // 0.5% — mock fee model, swap for a real one later.

@Injectable()
export class FeesService {
  /** Fee in major units for display in the transfer confirmation. */
  calculate(amount: string): string {
    const fee = Number(amount) * FEE_RATE;
    return fee.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }
}
