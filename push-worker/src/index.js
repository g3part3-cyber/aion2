import { buildPushPayload } from "@block65/webcrypto-web-push";

const NOTICE_LEAD_MS = 5 * 60 * 1000;
const SCHEDULE_CACHE_MS = 5 * 60 * 1000;
const NOTICE_WINDOW_MS = 90 * 1000;
const FIRED_TTL_SECONDS = 7 * 24 * 60 * 60;

class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

function corsHeaders(origin) {
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
    };
}

function jsonResponse(body, status, origin) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...corsHeaders(origin),
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
        },
    });
}

async function subscriptionKey(endpoint) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readJson(request) {
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > 16_384) throw new ApiError("요청 크기가 너무 큽니다.", 413);
    try {
        return await request.json();
    } catch {
        throw new ApiError("올바른 JSON 요청이 아닙니다.", 400);
    }
}

function validSubscription(subscription) {
    if (!subscription || typeof subscription.endpoint !== "string" || !subscription.keys) return false;
    try {
        return new URL(subscription.endpoint).protocol === "https:"
            && typeof subscription.keys.p256dh === "string"
            && typeof subscription.keys.auth === "string";
    } catch {
        return false;
    }
}

async function handleApiRequest(request, env) {
    const origin = request.headers.get("Origin");
    if (!origin || origin !== env.ALLOWED_ORIGIN) {
        return new Response("Forbidden", { status: 403 });
    }

    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    if (url.pathname === "/config" && request.method === "GET") {
        if (!env.VAPID_PUBLIC_KEY) return jsonResponse({ error: "푸시 공개 키가 설정되지 않았습니다." }, 503, origin);
        return jsonResponse({ vapidPublicKey: env.VAPID_PUBLIC_KEY }, 200, origin);
    }

    if (url.pathname !== "/subscribe") return jsonResponse({ error: "Not found" }, 404, origin);

    if (request.method === "POST") {
        const body = await readJson(request);
        const subscription = body.subscription;
        const definitionIds = body.definitionIds;
        if (!validSubscription(subscription)) {
            return jsonResponse({ error: "올바른 푸시 구독 정보가 아닙니다." }, 400, origin);
        }
        if (!Array.isArray(definitionIds)
            || definitionIds.length > 100
            || definitionIds.some((id) => typeof id !== "string" || !/^[a-z0-9_]{1,80}$/.test(id))) {
            return jsonResponse({ error: "알림 일정 선택이 올바르지 않습니다." }, 400, origin);
        }

        const key = await subscriptionKey(subscription.endpoint);
        await env.PUSH_DATA.put(`sub:${key}`, JSON.stringify({
            subscription,
            definitionIds: [...new Set(definitionIds)],
        }));
        return jsonResponse({ ok: true }, 200, origin);
    }

    if (request.method === "DELETE") {
        const body = await readJson(request);
        if (typeof body.endpoint !== "string") {
            return jsonResponse({ error: "구독 주소가 필요합니다." }, 400, origin);
        }
        await env.PUSH_DATA.delete(`sub:${await subscriptionKey(body.endpoint)}`);
        return jsonResponse({ ok: true }, 200, origin);
    }

    return jsonResponse({ error: "Method not allowed" }, 405, origin);
}

async function getSchedule(env, now) {
    const cachedData = await env.PUSH_DATA.get("schedule:data", "json");
    const fetchedAt = Number(await env.PUSH_DATA.get("schedule:fetched-at"));
    if (cachedData && now - fetchedAt < SCHEDULE_CACHE_MS) return cachedData;

    try {
        const response = await fetch(env.SCHEDULE_URL, { cf: { cacheTtl: 0 } });
        if (!response.ok) throw new Error(`일정 조회 실패 (HTTP ${response.status})`);
        const schedule = await response.json();
        if (!Array.isArray(schedule.occurrences)) throw new Error("일정 응답 형식이 올바르지 않습니다.");
        await env.PUSH_DATA.put("schedule:data", JSON.stringify(schedule));
        await env.PUSH_DATA.put("schedule:fetched-at", String(now));
        return schedule;
    } catch (error) {
        console.error("일정 새로고침 실패:", error);
        if (cachedData) {
            console.warn("저장된 일정 데이터로 계속 확인합니다.");
            return cachedData;
        }
        throw error;
    }
}

async function listSubscriptions(env) {
    const subscriptions = [];
    let cursor;
    do {
        const page = await env.PUSH_DATA.list({ prefix: "sub:", cursor });
        for (const entry of page.keys) {
            const value = await env.PUSH_DATA.get(entry.name, "json");
            if (value) subscriptions.push({ key: entry.name, ...value });
        }
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return subscriptions;
}

function noticeText(occurrence, label) {
    const name = occurrence.definitionId === "artifact_occupation"
        ? "아티 점령전"
        : occurrence.definitionId === "abyss_boss"
            ? "어비스 보스"
            : occurrence.name;
    const time = new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(occurrence.startAt);
    return {
        title: label === "5분 전" ? `🔔 ${name} 5분 전` : `🔔 ${name} 시작`,
        body: label === "5분 전" ? `${time}에 시작합니다.` : "지금 시작합니다.",
    };
}

async function deliverDueNotifications(env, now) {
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
        throw new Error("VAPID 푸시 키 설정이 누락되었습니다.");
    }
    const [schedule, subscriptions] = await Promise.all([
        getSchedule(env, now),
        listSubscriptions(env),
    ]);
    const vapid = {
        subject: env.VAPID_SUBJECT,
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
    };

    await Promise.all(subscriptions.map(async ({ key, subscription, definitionIds }) => {
        if (!Array.isArray(definitionIds) || !definitionIds.length) return;

        for (const occurrence of schedule.occurrences) {
            if (occurrence.cancelled || !definitionIds.includes(occurrence.definitionId)) continue;
            const notices = [
                { at: occurrence.startAt - NOTICE_LEAD_MS, label: "5분 전" },
                { at: occurrence.startAt, label: "시작" },
            ];
            for (const notice of notices) {
                if (now < notice.at || now - notice.at > NOTICE_WINDOW_MS) continue;

                const firedKey = `fired:${key}:${occurrence.occurrenceId}:${notice.label}`;
                if (await env.PUSH_DATA.get(firedKey)) continue;
                const { title, body } = noticeText(occurrence, notice.label);
                try {
                    const payload = await buildPushPayload({
                        data: JSON.stringify({
                            title,
                            body,
                            tag: `${occurrence.occurrenceId}:${notice.label}`,
                            url: "./",
                        }),
                        options: { ttl: 120 },
                    }, subscription, vapid);
                    const response = await fetch(subscription.endpoint, payload);
                    if (response.status === 404 || response.status === 410) {
                        await env.PUSH_DATA.delete(key);
                        return;
                    }
                    if (!response.ok) {
                        console.error(`푸시 전송 실패 (${response.status}):`, key);
                        continue;
                    }
                    await env.PUSH_DATA.put(firedKey, "1", { expirationTtl: FIRED_TTL_SECONDS });
                } catch (error) {
                    console.error("푸시 전송 처리 실패:", key, error);
                }
            }
        }
    }));
}

export default {
    async fetch(request, env) {
        try {
            return await handleApiRequest(request, env);
        } catch (error) {
            console.error("푸시 API 요청 실패:", error);
            const origin = request.headers.get("Origin");
            const status = error instanceof ApiError ? error.status : 500;
            return jsonResponse(
                { error: status === 500 ? "푸시 서버 내부 오류가 발생했습니다." : error.message },
                status,
                origin || env.ALLOWED_ORIGIN
            );
        }
    },

    scheduled(_controller, env, context) {
        context.waitUntil(deliverDueNotifications(env, Date.now()));
    },
};
