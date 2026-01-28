import { auth } from "@/app/(auth)/auth";
import {
  getChatById,
  getDsmSessionByChatId,
  getItemResponsesBySessionId,
} from "@/lib/db/queries";
import { scoreEvidenceIntegrity } from "@/lib/dsm5/evidence";
import type { EvidenceSpan } from "@/lib/dsm5/schemas";
import { ChatSDKError } from "@/lib/errors";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");

  const session = await auth();
  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  if (!chatId) {
    return new ChatSDKError(
      "bad_request:api",
      "Parameter chatId is required"
    ).toResponse();
  }

  const chat = await getChatById({ id: chatId });
  if (!chat) {
    return new ChatSDKError("not_found:chat").toResponse();
  }

  if (chat.userId !== session.user.id) {
    return new ChatSDKError("forbidden:chat").toResponse();
  }

  const dsmSession = await getDsmSessionByChatId({ chatId });
  if (!dsmSession) {

    return new ChatSDKError(
      "not_found:database",
      "No DSM-5 session found for this chat"
    ).toResponse();
    
  }

  const itemResponses = await getItemResponsesBySessionId({
    sessionId: dsmSession.id,
  });

  const transcript =
    (dsmSession.transcript as Array<{ role: string; text: string }>) ?? [];

  const integrity = scoreEvidenceIntegrity(
    itemResponses.map((response) => ({
      itemId: response.itemId,
      evidence: response.evidence as EvidenceSpan | undefined,
    })),
    transcript
  );

  return Response.json(integrity, { status: 200 });
}
