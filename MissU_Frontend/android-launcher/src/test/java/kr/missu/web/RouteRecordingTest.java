package kr.missu.web;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.location.*;
import android.os.*;
import org.junit.*;
import static org.junit.Assert.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.shadows.*;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import static org.robolectric.Shadows.shadowOf;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=33)
public class RouteRecordingTest {
    static final BlockingQueue<String> posts = new LinkedBlockingQueue<>();
    private final Application context = RuntimeEnvironment.getApplication();
    private static final String TOKEN = "synthetic-test-token";
    private static volatile String expectedToken = TOKEN;
    @BeforeClass public static void fakeServer() {
        URL.setURLStreamHandlerFactory(scheme -> !scheme.equals("https") ? null : new URLStreamHandler() {
            @Override protected URLConnection openConnection(URL url) {
                return new HttpURLConnection(url) {
                    final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                    public void disconnect() {} public boolean usingProxy(){return false;} public void connect(){}
                    public OutputStream getOutputStream(){return bytes;}
                    public int getResponseCode() {
                        if (!("Bearer "+expectedToken).equals(getRequestProperty("Authorization"))) return 403;
                        posts.add(url.getPath()+" "+bytes.toString()); return 200;
                    }
                };
            }
        });
    }
    @Test public void recordingContinuesWithoutActivityAndNotificationStopsCollection() throws Exception {
        shadowOf(context).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.POST_NOTIFICATIONS);
        RouteService.channel(context);
        LocationManager lm = context.getSystemService(LocationManager.class);
        shadowOf(lm).setProviderEnabled(LocationManager.GPS_PROVIDER,true);
        long now=System.currentTimeMillis();
        String id=UUID.randomUUID().toString();
        RouteService.begin(context,"test-account",TOKEN,id,now-60000,now+3600000);
        ServiceController<RouteService> controller=Robolectric.buildService(RouteService.class);
        RouteService service=controller.create().get();
        service.onStartCommand(new Intent(context,RouteService.class),0,1);
        assertEquals(id,RouteService.state(TOKEN).getString("id"));
        assertFalse(RouteService.state("another-account").has("id"));
        Notification recording=shadowOf(service).getLastForegroundNotification();
        assertNotNull(recording);
        assertEquals("기록 중지",recording.actions[0].title.toString());
        assertTrue((recording.flags & Notification.FLAG_ONGOING_EVENT)!=0);
        Location fix=new Location(LocationManager.GPS_PROVIDER);
        fix.setLatitude(37);fix.setLongitude(127);fix.setAccuracy(20);fix.setTime(now);
        service.onLocationChanged(fix);
        assertTrue(posts.poll(5,TimeUnit.SECONDS).contains("/"+id+"/points"));
        shadowOf(Looper.getMainLooper()).idle();
        RouteService.stopFor("another-account");
        assertTrue(RouteService.isRecording());
        RouteService.reconcile("test-account", "renewed-token");
        expectedToken = "renewed-token";
        assertEquals(id, RouteService.state(expectedToken).getString("id"));
        assertFalse(RouteService.state(TOKEN).has("id"));
        Intent action=shadowOf(recording.actions[0].actionIntent).getSavedIntent();
        service.onStartCommand(action,0,2);
        assertFalse(RouteService.isRecording());
        shadowOf(Looper.getMainLooper()).idle();
        assertTrue(posts.poll(5,TimeUnit.SECONDS).contains("/"+id+"/stop"));
        fix.setTime(now+16000);
        service.onLocationChanged(fix);
        assertTrue(posts.isEmpty());
        controller.destroy();
        RouteService.begin(context,"test-account",expectedToken,UUID.randomUUID().toString(),now-1000,now+3600000);
        RouteService.reconcile("different-account", "other-token");
        assertFalse(RouteService.isRecording());
        assertTrue(posts.poll(5,TimeUnit.SECONDS).contains("/stop"));
        shadowOf(Looper.getMainLooper()).idle();
        RouteService.begin(context,"test-account",expectedToken,UUID.randomUUID().toString(),now-1000,now+3600000);
        RouteService.reconcile("", "");
        assertFalse(RouteService.isRecording());
        assertTrue(posts.poll(5,TimeUnit.SECONDS).contains("/stop"));
        shadowOf(Looper.getMainLooper()).idle();
    }
}

