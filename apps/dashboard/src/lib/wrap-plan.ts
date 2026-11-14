export interface WrapPlan {
  register: boolean;
  wrapYocto: bigint;
}

export function planWrap({ price, balance, registered }: { price: bigint; balance: bigint; registered: boolean }): WrapPlan | null {
  if (balance >= price) return null;
  return { register: !registered, wrapYocto: price - balance };
}
