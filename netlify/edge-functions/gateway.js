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

function showStatusPage() {
  const html = `<!DOCTYPE html>
<html lang="fa">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Netlify Edge Gateway - Status</title>
    <style>
        body {
            font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            line-height: 1.6;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        .container {
            background: rgba(255,255,255,0.1);
            border-radius: 20px;
            padding: 40px;
            backdrop-filter: blur(10px);
        }
        h1 { margin-top: 0; }
        .status {
            background: rgba(0,255,0,0.2);
            border-left: 4px solid #00ff00;
            padding: 15px;
            margin: 20px 0;
            border-radius: 8px;
        }
        .info {
            background: rgba(0,0,0,0.3);
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
            font-family: monospace;
        }
        code {
            background: rgba(0,0,0,0.3);
            padding: 2px 6px;
            border-radius: 4px;
            font-family: monospace;
        }
        hr {
            border-color: rgba(255,255,255,0.2);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>✅ Edge Gateway Active</h1>
        <div class="status">
            🟢 Service is running normally
        </div>
        <p>این سرویس برای پروکسی کردن درخواست‌ها به سرور upstream تنظیم شده است.</p>
        <div class="info">
            <strong>📡 اطلاعات:</strong><br>
            Upstream Server: <code>${UPSTREAM_SERVER}</code><br>
            Status: Online<br>
            Time: ${new Date().toLocaleString("fa-IR")}
        </div>
        <p>برای استفاده از این سرویس، کلاینت خود را با تنظیمات زیر پیکربندی کنید:</p>
        <div class="info">
            <strong>🔧 تنظیمات پیشنهادی (XHTTP Extra Raw Json):</strong><br>
            <code>{"xPaddingBytes":"100-1000","xPaddingObfsMode":true,"xPaddingKey":"xehsan","xPaddingHeader":"XEhsan","mode":"auto","scMaxEachPostBytes":1000000}</code>
        </div>
        <hr>
        <small>Edge Gateway v3.0 | Deployed on Netlify</small>
    </div>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

export default async function gateway(request, context) {
  const url = new URL(request.url);
  const clientIp = context.ip || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  
  // اگه کسی مستقیم دامنه Netlify رو باز کرد و x-host نداشت، صفحه وضعیت نشون بده
  const xHost = request.headers.get("x-host");
  if (url.pathname === "/" && !xHost) {
    return showStatusPage();
  }
  
  if (!UPSTREAM_SERVER) {
    return new Response("Service configuration error", { status: 503 });
  }
  
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
