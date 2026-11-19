package kr.missu.web;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.Uri;
import android.os.*;
import android.webkit.*;
import android.view.*;
import android.widget.FrameLayout;
import org.json.*;
import java.io.*;
import java.net.*;
import java.util.*;

public final class MissuLauncher extends Activity {
    private static final String SITE = "https://missu-web.onrender.com";
    private static final int PREPARE = 16, GEO = 17, FILE = 18;
    private WebView web;
    private WebMessagePort port;
    private int navigation, permissionRequest;
    private String preparedToken;
    private long preparedUntil;
    private boolean foreground, networkAlert;
    private GeolocationPermissions.Callback geo;
    private String geoOrigin;
    private ValueCallback<Uri[]> fileCallback;
    private String bootstrap;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        RouteService.channel(this);
        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(0xffffffff);
        frame.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        web = new WebView(this);
        frame.addView(web);
        setContentView(frame);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " MissUAndroidRoute/2");
        web.setWebViewClient(new SiteClient());
        web.setWebChromeClient(new ChromeClient());
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    () -> { if (web.canGoBack()) web.goBack(); else finish(); });
        }
        try (InputStream input = getAssets().open("route-port.js")) { bootstrap = read(input); }
        catch (IOException e) { throw new IllegalStateException(e); }
        // 짧은 사전 확인 실패로 오래된 APK 화면에 고정되지 않도록 운영 화면을 직접 엽니다.
        // HTML만 재검증하고, 해시가 붙은 사진/스크립트의 정상 캐시는 유지합니다.
        boolean openRoute = "kr.missu.web.OPEN_ROUTE".equals(getIntent().getAction());
        web.loadUrl(SITE + (openRoute ? "/daily-route" : "/"),
                Collections.singletonMap("Cache-Control", "no-cache"));
    }
    private static String read(InputStream input) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192]; int n;
        while ((n = input.read(chunk)) != -1) {
            bytes.write(chunk, 0, n);
            if (bytes.size() > 524288) throw new IOException("Page too large");
        }
        return bytes.toString("UTF-8");
    }
    private static boolean trusted(Uri uri) {
        return uri != null && "https".equalsIgnoreCase(uri.getScheme())
            && "missu-web.onrender.com".equalsIgnoreCase(uri.getHost()) && uri.getUserInfo() == null
            && (uri.getPort() == -1 || uri.getPort() == 443);
    }
    private final class SiteClient extends WebViewClient {
        @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame() || !trusted(request.getUrl()) || networkAlert || isFinishing()) return;
            networkAlert = true;
            new AlertDialog.Builder(MissuLauncher.this)
                    .setTitle("미슈 연결을 확인해 주세요")
                    .setMessage("인터넷 연결을 확인한 뒤 다시 시도해 주세요.")
                    .setPositiveButton("다시 시도", (dialog, which) -> web.loadUrl(SITE + "/",
                            Collections.singletonMap("Cache-Control", "no-cache")))
                    .setNegativeButton("닫기", null)
                    .setOnDismissListener(dialog -> networkAlert = false).show();
        }
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return request.isForMainFrame() && external(request.getUrl());
        }
        @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return external(Uri.parse(url)); }
        private boolean external(Uri uri) {
            if (trusted(uri)) return false;
            if (Arrays.asList("https","http","tel","mailto","geo").contains(uri.getScheme())) {
                try {
                    startActivity(new Intent("tel".equals(uri.getScheme()) ? Intent.ACTION_DIAL : Intent.ACTION_VIEW, uri)
                            .addCategory(Intent.CATEGORY_BROWSABLE));
                } catch (ActivityNotFoundException ignored) {}
            }
            return true;
        }
        @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
            navigation++;
            preparedToken = null; permissionRequest = 0;
            if (port != null) { port.close(); port = null; }
        }
        @Override public void onPageFinished(WebView view, String url) {
            if (!trusted(Uri.parse(url)) || !url.equals(view.getUrl()) || port != null) return;
            final int version = navigation;
            web.evaluateJavascript(bootstrap, ignored -> {
                if (navigation != version || port != null || isDestroyed()) return;
                WebMessagePort[] pair = web.createWebMessageChannel();
                port = pair[0];
                port.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
                    @Override public void onMessage(WebMessagePort sender, WebMessage msg) {
                        if (sender == port && navigation == version) handle(msg.getData());
                    }
                });
                web.postWebMessage(new WebMessage("missu-route-port-v2", new WebMessagePort[]{pair[1]}), Uri.parse(SITE));
            });
        }
    }
    private class ChromeClient extends WebChromeClient {
        @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            if (!trusted(Uri.parse(origin))) { callback.invoke(origin, false, false); return; }
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                callback.invoke(origin, true, false); return;
            }
            if (geo != null || permissionRequest != 0) { callback.invoke(origin, false, false); return; }
            geo = callback; geoOrigin = origin;
            requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION}, GEO);
        }
        @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try { startActivityForResult(params.createIntent(), FILE); }
            catch (ActivityNotFoundException error) { callback.onReceiveValue(null); fileCallback = null; }
            return true;
        }
    }
    @Override public void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != FILE || fileCallback == null) return;
        Uri[] picked = WebChromeClient.FileChooserParams.parseResult(result, data);
        if (picked != null) for (Uri uri : picked) {
            if (!"content".equals(uri.getScheme()) || getPackageName().equals(uri.getAuthority())) { picked = null; break; }
        }
        fileCallback.onReceiveValue(picked); fileCallback = null;
    }
    private void handle(String raw) {
        int request = 0;
        try {
            JSONObject args = new JSONObject(raw);
            request = args.getInt("request");
            String token = args.getString("token");
            if (token.isEmpty() || token.length() > 4096) throw new IllegalStateException("다시 로그인해 주세요.");
            switch (args.getString("command")) {
                case "prepare":
                    if (!foreground || geo != null || permissionRequest != 0)
                        throw new IllegalStateException("위치 권한 창을 닫은 뒤 이 화면에서 다시 시작해 주세요.");
                    if (RouteService.isRecording()) throw new IllegalStateException("먼저 알림에서 이전 기록을 중지해 주세요.");
                    if (!locationEnabled()) throw new IllegalStateException("휴대폰 설정에서 위치를 켜 주세요.");
                    preparedToken = token;
                    permissionRequest = request;
                    ArrayList<String> missing = new ArrayList<>();
                    if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                        missing.add(Manifest.permission.ACCESS_COARSE_LOCATION); missing.add(Manifest.permission.ACCESS_FINE_LOCATION);
                    }
                    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                        missing.add(Manifest.permission.POST_NOTIFICATIONS);
                    if (missing.isEmpty()) finishPermission(); else requestPermissions(missing.toArray(new String[0]), PREPARE);
                    return;
                case "start":
                    if (!foreground || !token.equals(preparedToken) || SystemClock.elapsedRealtime() > preparedUntil)
                        throw new IllegalStateException("이동 경로 화면에서 다시 기록을 시작해 주세요.");
                    preparedToken = null;
                    if (!locationEnabled()) throw new IllegalStateException("휴대폰 위치를 켠 뒤 다시 시작해 주세요.");
                    RouteService.begin(this, token, args.getString("id"), args.getLong("start"), args.getLong("end"));
                    break;
                case "status": break;
                case "stop": RouteService.stopFor(token); break;
                default: throw new IllegalArgumentException();
            }
            reply(request, RouteService.state(token), null);
        } catch (Exception error) { reply(request, null, error instanceof IllegalStateException ? error.getMessage() : "경로 기록 요청을 처리하지 못했어요."); }
    }
    private boolean locationEnabled() {
        LocationManager manager = getSystemService(LocationManager.class);
        if (Build.VERSION.SDK_INT >= 28) return manager.isLocationEnabled();
        return manager.isProviderEnabled(LocationManager.GPS_PROVIDER) || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
    }
    private void reply(int request, JSONObject state, String error) {
        if (port == null || request == 0) return;
        try { port.postMessage(new WebMessage(new JSONObject().put("request", request).put("state", state).put("error", error).toString())); }
        catch (JSONException | IllegalStateException ignored) {}
    }
    private void finishPermission() {
        if (RouteService.allowed(this)) {
            preparedUntil = SystemClock.elapsedRealtime() + 180000;
            reply(permissionRequest, null, null);
        } else {
            preparedToken = null;
            reply(permissionRequest, null, "휴대폰 설정 → 앱 → 미슈에서 정확한 위치와 기록 알림을 허용해 주세요.");
        }
        permissionRequest = 0;
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == PREPARE) finishPermission();
        if (code == GEO && geo != null) {
            boolean ok = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
                        || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            geo.invoke(geoOrigin, ok, false); geo = null;
        }
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // SPA 문서를 다시 불러오면 메모리 로그인 세션이 사라지므로 기존 화면을 유지합니다.
        setIntent(intent);
    }
    @Override protected void onResume() { super.onResume(); foreground = true; }
    @Override protected void onPause() { foreground = false; super.onPause(); }
    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onDestroy() { if (port != null) port.close(); web.destroy(); super.onDestroy(); }
}

