"use server";

import type { ActionState } from "../actions";

export async function submitPasswordResetAction(
  prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { requestPasswordResetAction } = await import("../actions");
  return requestPasswordResetAction(prevState, formData);
}
