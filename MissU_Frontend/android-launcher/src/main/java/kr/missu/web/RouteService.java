package kr.missu.web;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.location.*;
import android.os.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.*;

public final class RouteService extends Service implements LocationListener {
    static final String CHANNEL = "missu_route_recording";
    static final String STOP = "kr.missu.web.STOP_ROUTE";
    static final int NOTICE = 48;
    private static final long DAY = 86400000L;
    private static final ExecutorService io = Executors.newSingleThreadExecutor();
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static Session current;
    private static RouteService running;
    private LocationManager locations;

    private static final class Session {
        final String token, id;
        final long start, end;
        final ArrayList<JSONObject> pending = new ArrayList<>();
        long lastFix, retryAfter, finishBy;
        int saved, failures;
        boolean uploading, stopped;
        String message = "출발 지점의 위치 신호를 기다리고 있어요.";
        Session(String token, String id, long start, long end) {
            this.token = token; this.id = id; this.start = start; this.end = end;
        }
    }

    static void channel(Context context) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "이동 경로 기록", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("휴대폰 위치를 기록하는 동안 중지 버튼을 표시합니다.");
            context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }
    static boolean allowed(Context context) {
        if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return false;
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        return (Build.VERSION.SDK_INT < 24 || notifications.areNotificationsEnabled())
            && (Build.VERSION.SDK_INT < 26 || notifications.getNotificationChannel(CHANNEL).getImportance() != NotificationManager.IMPORTANCE_NONE);
    }
    static void begin(Context context, String token, String id, long start, long end) {
        UUID.fromString(id);
        long now = System.currentTimeMillis();
        if (token.isEmpty() || start <= 0 || end <= now || end - start > DAY + 1000 || end <= start)
            throw new IllegalArgumentException("기록 시간이 만료됐어요. 다시 시작해 주세요.");
        if (!allowed(context)) throw new IllegalStateException("정확한 위치와 기록 알림을 허용해 주세요.");
        if (current != null) {
            if (current.id.equals(id) && current.token.equals(token)) return;
            throw new IllegalStateException("먼저 알림에서 이전 경로 기록을 중지해 주세요.");
        }
        current = new Session(token, id, start, end);
        Intent intent = new Intent(context, RouteService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (RuntimeException error) { current = null; throw error; }
    }
    static JSONObject state(String token) throws JSONException {
        JSONObject state = new JSONObject();
        if (current != null && current.token.equals(token)) {
            state.put("id", current.id).put("saved", current.saved).put("message", current.message);
        }
        return state;
    }
    static void stopFor(String token) {
        if (current != null && current.token.equals(token)) finish(current);
    }
    static boolean isRecording() { return current != null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        running = this;
        channel(this);
        if (current == null) { stopSelf(); return START_NOT_STICKY; }
        if (intent != null && STOP.equals(intent.getAction())) {
            if (current.id.equals(intent.getStringExtra("id"))) finish(current);
            return START_NOT_STICKY;
        }
        startForeground(NOTICE, notification());
        locations = getSystemService(LocationManager.class);
        try {
            boolean available = false;
            for (String provider : new String[]{LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER}) {
                if (!locations.isProviderEnabled(provider)) continue;
                locations.requestLocationUpdates(provider, 15000, 0, this, Looper.getMainLooper());
                available = true;
            }
            if (!available) throw new IllegalStateException();
            main.removeCallbacks(tick);
            main.post(tick);
        } catch (RuntimeException error) { finish(current); }
        return START_NOT_STICKY;
    }
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            Session session = current;
            if (session == null) return;
            if (!allowed(RouteService.this) || System.currentTimeMillis() >= session.end) { finish(session); return; }
            flush(session);
            main.postDelayed(this, 15000);
        }
    };
    private Notification notification() {
        Intent action = new Intent(this, RouteService.class).setAction(STOP).putExtra("id", current.id);
        action.setData(android.net.Uri.parse("missu-stop:" + current.id));
        int flags = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent stop = PendingIntent.getService(this, 0, action, flags);
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MissuLauncher.class)
                .setAction("kr.missu.web.OPEN_ROUTE").addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP), flags);
        Notification.Builder notice = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        return notice.setSmallIcon(R.drawable.ic_route).setContentTitle("미슈 · 이동 경로 기록 중")
                .setContentText("화면을 잠가도 기록해요. 아래에서 중지할 수 있어요.")
                .setContentIntent(open).setOnlyAlertOnce(true).setOngoing(true).setShowWhen(true)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_pause, "기록 중지", stop).build()).build();
    }
    @Override public void onLocationChanged(Location fix) {
        Session session = current;
        if (session == null) return;
        long time = fix.getTime(), now = System.currentTimeMillis();
        if (now >= session.end) { finish(session); return; }
        if (!fix.hasAccuracy() || !(fix.getAccuracy() >= 0 && fix.getAccuracy() <= 250)
            || time < session.start || time >= session.end || time < now - 15000 || time > now + 1000
            || time - session.lastFix < 15000) return;
        try {
            SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
            iso.setTimeZone(TimeZone.getTimeZone("UTC"));
            session.pending.add(new JSONObject().put("clientPointId", UUID.randomUUID().toString())
                    .put("recordedAt", iso.format(new Date(time))).put("lat", fix.getLatitude())
                    .put("lng", fix.getLongitude()).put("accuracyM", Math.round(fix.getAccuracy())));
            session.lastFix = time;
            flush(session);
        } catch (JSONException ignored) { /* 유효하지 않은 센서값은 전송하지 않습니다. */ }
    }
    @Override public void onProviderEnabled(String provider) {}
    @Override public void onProviderDisabled(String provider) {}
    @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onDestroy() {
        if (running == this) {
            removeLocation();
            running = null;
            if (current != null) finish(current);
        }
        super.onDestroy();
    }
    private void removeLocation() {
        main.removeCallbacks(tick);
        if (locations != null) { locations.removeUpdates(this); locations = null; }
    }
    private static void finish(Session session) {
        if (session == null || session.stopped) return;
        session.stopped = true;
        session.finishBy = System.currentTimeMillis() + 180000;
        session.retryAfter = 0;
        current = null;
        if (running != null) {
            running.removeLocation();
            running.stopForeground(true);
            running.stopSelf();
            running = null;
        }
        flush(session);
    }
    // 전송 실패 시 같은 점 ID를 재사용해 중복 없이 이어 보냅니다.
    private static void flush(Session session) {
        if (session.uploading || System.currentTimeMillis() < session.retryAfter) return;
        int count = Math.min(100, session.pending.size());
        if (count == 0 && !session.stopped) return;
        if (session.stopped && System.currentTimeMillis() >= session.finishBy) {
            session.pending.clear();
            count = 0;
        }
        final int batchSize = count;
        JSONArray batch = new JSONArray();
        for (int i = 0; i < count; i++) batch.put(session.pending.get(i));
        session.uploading = true;
        io.execute(() -> {
            int status = 0;
            try {
                JSONObject body = new JSONObject();
                if (batchSize > 0) body.put("points", batch);
                status = post(session, batchSize > 0 ? "points" : "stop", body);
            } catch (Exception ignored) { /* 일시적인 연결 실패는 다시 시도합니다. */ }
            final int result = status;
            main.post(() -> {
                session.uploading = false;
                if (result >= 200 && result < 300) {
                    session.failures = 0;
                    if (batchSize == 0) return;
                    session.pending.subList(0, batchSize).clear();
                    session.saved += batchSize;
                    session.message = "최근 위치를 내 계정에 저장했어요.";
                    flush(session);
                } else if (result == 401 || result == 403 || result == 404 || result == 409) {
                    session.pending.clear();
                    if (!session.stopped) finish(session);
                } else {
                    session.message = "연결을 기다리고 있어요. 기록 중인 위치는 연결되면 다시 보내요.";
                    long delay = Math.min(60000, 2000L << Math.min(5, session.failures++));
                    session.retryAfter = System.currentTimeMillis() + delay;
                    if (session.stopped && (batchSize > 0 || session.retryAfter < session.finishBy))
                        main.postDelayed(() -> flush(session), delay + 50);
                }
            });
        });
    }
    private static int post(Session session, String operation, JSONObject body) throws IOException {
        URL url = new URL("https://missu-api-wkdu.onrender.com/api/v1/me/routes/recordings/" + session.id + "/" + operation);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(12000); connection.setReadTimeout(35000);
            connection.setRequestMethod("POST"); connection.setDoOutput(true);
            connection.setRequestProperty("Authorization", "Bearer " + session.token);
            connection.setRequestProperty("Content-Type", "application/json");
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body.toString().getBytes("UTF-8"));
            }
            return connection.getResponseCode();
        } finally { connection.disconnect(); }
    }
}

