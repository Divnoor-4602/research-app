import { registerOTel } from "@vercel/otel";

export function register() {
  registerOTel({ serviceName: "dsm5-research-app" });
}
