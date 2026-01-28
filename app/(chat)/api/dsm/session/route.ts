import { auth } from "@/app/(auth)/auth";
import {
  getChatById,
  getDsmSessionByChatId,
  getItemResponsesBySessionId,
} from "@/lib/db/queries";
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
    return new ChatSDKError("not_found:api", "No DSM-5 session found for this chat").toResponse();
  }

  const itemResponses = await getItemResponsesBySessionId({
    sessionId: dsmSession.id,
  });

  return Response.json(
    {
      session: {
        transcript: dsmSession.transcript,
        sessionStatus: dsmSession.sessionStatus,
        questionState: dsmSession.questionState,
        riskFlags: dsmSession.riskFlags,
      },
      itemResponses,
    },
    { status: 200 }
  );
}
