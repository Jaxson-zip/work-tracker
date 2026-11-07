export type SendClawBotMessageResult =
  | { status: "sent" }
  | { status: "skipped"; reason: "not_configured" }
  | { status: "failed"; reason: string };

export async function sendClawBotMessage(providerUserId: string, text: string): Promise<SendClawBotMessageResult> {
  const url = process.env.CLAWBOT_SEND_MESSAGE_URL;
  const token = process.env.CLAWBOT_SEND_MESSAGE_TOKEN;
  if (!url || !token) return { status: "skipped", reason: "not_configured" };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: providerUserId,
        userId: providerUserId,
        recipientId: providerUserId,
        text,
        message: text,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { status: "failed", reason: `${response.status} ${body.slice(0, 200)}` };
    }

    return { status: "sent" };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}
