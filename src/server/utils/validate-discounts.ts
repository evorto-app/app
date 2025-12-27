import { TRPCError } from '@trpc/server';

export type DiscountConfig = {
  discountedPrice: number;
  discountType: 'esnCard';
};

type ValidateDiscountsInput = {
  discounts?: readonly DiscountConfig[] | null | undefined;
  isPaid: boolean;
  price: number;
  title: string;
};

export const validateDiscountConfiguration = ({
  discounts,
  isPaid,
  price,
  title,
}: ValidateDiscountsInput) => {
  const normalized = discounts ?? [];
  if (normalized.length === 0) {
    return;
  }

  if (!isPaid) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Registration option "${title}": discounts require a paid option.`,
    });
  }

  const seenTypes = new Set<string>();
  for (const discount of normalized) {
    if (discount.discountedPrice > price) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Registration option "${title}": discount price must be <= base price.`,
      });
    }
    if (seenTypes.has(discount.discountType)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Registration option "${title}": duplicate discount type "${discount.discountType}".`,
      });
    }
    seenTypes.add(discount.discountType);
  }
};
