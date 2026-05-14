const UPSTREAM_SERVER = "https://panelgame.fc26gamerprohelponline.online:2053";
const ENABLE_LOGGING = true;

const FORBIDDEN_HEADERS = new Set([
  "host", "connection", "keep-alive", "upgrade",
  "proxy-connection", "transfer-encoding", "te",
  "x-nf-request-id", "x-netlify-edge"
]);

function prepareHeaders(originalHeaders, clientIp) {
  const cleanHeaders = new Headers();
  
  for (const [key, value] of originalHeaders) {
    const lowerKey = key.toLowerCase();
    if (FORBIDDEN_HEADERS.has(lowerKey)) continue;
    if (lowerKey.startsWith("x-nf-") || lowerKey.startsWith("x-netlify-")) continue;
    cleanHeaders.set(key, value);
  }
  
  if (clientIp) {
    cleanHeaders.set("x-real-ip", clientIp);
    const existing = cleanHeaders.get("x-forwarded-for");
    cleanHeaders.set("x-forwarded-for", existing ? `${existing}, ${clientIp}` : clientIp);
  }
  
  if (!cleanHeaders.has("user-agent")) {
    cleanHeaders.set("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
  }
  
  return cleanHeaders;
}

export default async function gateway(request, context) {
  if (!UPSTREAM_SERVER) {
    return new Response("Service configuration error", { status: 503 });
  }
  
  const url = new URL(request.url);
  const clientIp = context.ip || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const targetUrl = UPSTREAM_SERVER + (url.pathname === "/" ? "" : url.pathname) + url.search;
  
  if (ENABLE_LOGGING) console.log(`[GATEWAY] ${request.method} ${targetUrl}`);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: prepareHeaders(request.headers, clientIp),
      redirect: "manual",
      signal: controller.signal,
      body: !["GET", "HEAD", "OPTIONS"].includes(request.method) ? request.body : undefined
    });
    
    clearTimeout(timeoutId);
    
    const responseHeaders = new Headers();
    for (const [key, value] of response.headers) {
      if (key.toLowerCase() !== "transfer-encoding" && key.toLowerCase() !== "connection") {
        responseHeaders.set(key, value);
      }
    }
    
    responseHeaders.set("x-content-type-options", "nosniff");
    
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });
    
  } catch (error) {
    if (ENABLE_LOGGING) console.error(`[GATEWAY] Error: ${error.message}`);
    return new Response("Gateway error", { status: 502 });
  }
}
