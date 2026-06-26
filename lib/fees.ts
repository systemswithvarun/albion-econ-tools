export const SETUP_FEE = 0.025

export function taxRate(premium: boolean): number {
  return premium ? 0.04 : 0.08
}

/** Take a sell_order (instant buy): pay listed price, no extra fee */
export function instantBuyCost(price: number): number {
  return price
}

/** Place a buy_order: price + 2.5% setup fee locked upfront */
export function buyOrderCost(price: number): number {
  return price * (1 + SETUP_FEE)
}

/** Hit a buy_order (instant sell): receive price minus tax */
export function instantSellNet(price: number, premium: boolean): number {
  return price * (1 - taxRate(premium))
}

/** Place a sell_order: receive price minus tax minus setup fee */
export function sellOrderNet(price: number, premium: boolean): number {
  return price * (1 - taxRate(premium) - SETUP_FEE)
}
