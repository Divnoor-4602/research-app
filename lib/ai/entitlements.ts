import type { UserType } from "@/app/(auth)/auth";

type Entitlements = {
  maxMessagesPerDay: number;
};

export const entitlementsByUserType: Record<UserType, Entitlements> = {
  /*
   * For users without an account
   */
  guest: {
    maxMessagesPerDay: Number.POSITIVE_INFINITY,
  },

  /*
   * For users with an account
   */
  regular: {
    maxMessagesPerDay: Number.POSITIVE_INFINITY,
  },

  /*
   * TODO: For users with an account and a paid membership
   */
};
