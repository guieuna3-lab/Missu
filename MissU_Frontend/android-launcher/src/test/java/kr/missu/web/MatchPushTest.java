package kr.missu.web;

import android.app.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import com.google.firebase.messaging.RemoteMessage;
import java.util.UUID;
import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=33)
public class MatchPushTest {
    @Test public void onlyCurrentAccountReceivesNotificationAndLogoutClearsIt() {
        MatchPushService service = Robolectric.buildService(MatchPushService.class).create().get();
        NotificationManager manager = service.getSystemService(NotificationManager.class);
        String binding = UUID.randomUUID().toString();
        MatchPushService.prefs(service).edit().putBoolean("enabled",true).putString("binding",binding).apply();
        service.onMessageReceived(new RemoteMessage.Builder("test")
            .addData("binding","old-account").addData("notificationId",UUID.randomUUID().toString()).build());
        assertEquals(0,shadowOf(manager).size());
        service.onMessageReceived(new RemoteMessage.Builder("test")
            .addData("binding",binding).addData("notificationId",UUID.randomUUID().toString()).build());
        assertEquals(1,shadowOf(manager).size());
        Notification notification = shadowOf(manager).getNotification("missu-matches",7);
        assertEquals("kr.missu.web.OPEN_NOTIFICATIONS", shadowOf(notification.contentIntent).getSavedIntent().getAction());
        MatchPushService.clear(service);
        assertEquals(0,shadowOf(manager).size());
        service.onMessageReceived(new RemoteMessage.Builder("test")
            .addData("binding",binding).addData("notificationId",UUID.randomUUID().toString()).build());
        assertEquals(0,shadowOf(manager).size());
    }
}
