// Advanced Edge Gateway - Optimized Proxy Solution
// Version: 2.0.0

const UPSTREAM_SERVER = (Netlify.env.get("UPSTREAM_ENDPOINT") || "").trim().replace(/\/$/, "");
const ENABLE_LOGGING = Netlify.env.get("DEBUG_MODE") === "true";
const REQUEST_TIMEOUT = 30000;

// Headers that should not be forwarded
const FORBIDDEN_HEADERS = new Set([
  "host", "connection", "keep-alive", "upgrade",
  "proxy-connection", "transfer-encoding", "te",
  "x-nf-request-id", "x-netlify-edge"
]);

// Safe headers for client IP preservation
const FORWARD_HEADERS = new Set([
  "x-forwarded-for", "x-real-ip", "cf-connecting-ip"
]);

/**
 * Clean and prepare headers for forwarding
 */
function prepareHeaders(originalHeaders, clientInfo) {
  const cleanHeaders = new Headers();
  
  for (const [key, value] of originalHeaders) {
    const lowerKey = key.toLowerCase();
    
    // Skip forbidden headers
    if (FORBIDDEN_HEADERS.has(lowerKey)) continue;
    
    // Skip Netlify internal headers
    if (lowerKey.startsWith("x-nf-") || lowerKey.startsWith("x-netlify-")) continue;
    
    // Add safe headers
    cleanHeaders.set(key, value);
  }
  
  // Add client IP information
  if (clientInfo.ip) {
    cleanHeaders.set("x-real-ip", clientInfo.ip);
    const existingForwarded = cleanHeaders.get("x-forwarded-for");
    cleanHeaders.set("x-forwarded-for", existingForwarded ? `${existingForwarded}, ${clientInfo.ip}` : clientInfo.ip);
  }
  
  // Standard browser user agent if missing
  if (!cleanHeaders.has("user-agent")) {
    cleanHeaders.set("user-agent", "Mozilla/5.0 (compatible; Gateway/2.0)");
  }
  
  return cleanHeaders;
}

/**
 * Log request details for debugging
 */
function logRequest(method, path, status, duration) {
  if (ENABLE_LOGGING) {
    console.log(`[GATEWAY] ${method} ${path} → ${status} (${duration}ms)`);
  }
}

export default async function gateway(request, context) {
  // Check configuration
  if (!UPSTREAM_SERVER) {
    console.error("[GATEWAY] Configuration error: Missing UPSTREAM_ENDPOINT");
    return new Response("Service configuration error", { 
      status: 503,
      headers: { "content-type": "text/plain" }
    });
  }
  
  const startTime = Date.now();
  const url = new URL(request.url);
  const clientIp = context.ip || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  
  // Build target URL
  const targetPath = url.pathname === "/" ? "" : url.pathname;
  const targetUrl = `${UPSTREAM_SERVER}${targetPath}${url.search}`;
  
  try {
    // Prepare headers
    const forwardHeaders = prepareHeaders(request.headers, { ip: clientIp });
    
    // Determine request method and body handling
    const method = request.method;
    const hasBody = !["GET", "HEAD", "OPTIONS"].includes(method);
    
    // Configure fetch options
    const fetchConfig = {
      method: method,
      headers: forwardHeaders,
      redirect: "manual"
    };
    
    // Add body for supported methods
    if (hasBody && request.body) {
      fetchConfig.body = request.body;
    }
    
    // Add timeout control
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    fetchConfig.signal = controller.signal;
    
    // Execute upstream request
    const upstreamResponse = await fetch(targetUrl, fetchConfig);
    clearTimeout(timeoutId);
    
    // Process response headers
    const responseHeaders = new Headers();
    for (const [key, value] of upstreamResponse.headers) {
      const lowerKey = key.toLowerCase();
      // Skip problematic response headers
      if (lowerKey !== "transfer-encoding" && lowerKey !== "connection") {
        responseHeaders.set(key, value);
      }
    }
    
    // Add security headers
    responseHeaders.set("x-content-type-options", "nosniff");
    responseHeaders.set("x-frame-options", "DENY");
    
    // Log successful request
    logRequest(method, url.pathname, upstreamResponse.status, Date.now() - startTime);
    
    // Return response
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders
    });
    
  } catch (error) {
    // Handle different error types
    const duration = Date.now() - startTime;
    console.error(`[GATEWAY] Error for ${request.method} ${url.pathname}:`, error.message);
    
    let statusCode = 502;
    let errorMessage = "Gateway connection failed";
    
    if (error.name === "AbortError") {
      statusCode = 504;
      errorMessage = "Gateway timeout";
    } else if (error.message.includes("ENOTFOUND") || error.message.includes("DNS")) {
      statusCode = 502;
      errorMessage = "Cannot resolve upstream server";
    } else if (error.message.includes("CERT") || error.message.includes("SSL")) {
      statusCode = 502;
      errorMessage = "SSL certificate error";
    }
    
    logRequest(request.method, url.pathname, statusCode, duration);
    
    return new Response(errorMessage, {
      status: statusCode,
      headers: { "content-type": "text/plain" }
    });
  }
}
