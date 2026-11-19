package kr.missu.web;

import android.app.*;
import android.content.*;
import android.os.Build;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/** 로그인 연결값이 맞는 알림만 표시합니다. 위치·분실 특징은 푸시 내용에 넣지 않습니다. */
public final class MatchPushService extends FirebaseMessagingService {
    static final String CHANNEL = "missu-found-matches";
    static android.content.SharedPreferences prefs(Context c) { return c.getSharedPreferences("match-push",Context.MODE_PRIVATE); }
    static void channel(Context c) {
        if(Build.VERSION.SDK_INT>=26) c.getSystemService(NotificationManager.class).createNotificationChannel(
            new NotificationChannel(CHANNEL,"비슷한 습득물",NotificationManager.IMPORTANCE_DEFAULT));
    }
    static void clear(Context c) {
        prefs(c).edit().remove("binding").remove("account").putBoolean("enabled",false).apply();
        c.getSystemService(NotificationManager.class).cancel("missu-matches",7);
    }
    @Override public void onNewToken(String token) { prefs(this).edit().putString("token",token).apply(); }
    @Override public void onMessageReceived(RemoteMessage message) {
        String binding=message.getData().get("binding"),id=message.getData().get("notificationId");
        android.content.SharedPreferences p=prefs(this);
        if(!p.getBoolean("enabled",false)||binding==null||!binding.equals(p.getString("binding",""))
            ||id==null||!id.matches("[0-9a-f-]{36}")||id.equals(p.getString("last",""))) return;
        NotificationManager manager=getSystemService(NotificationManager.class);
        if(Build.VERSION.SDK_INT>=24&&!manager.areNotificationsEnabled())return;
        channel(this);
        Intent intent=new Intent(this,MissuLauncher.class).setAction("kr.missu.web.OPEN_NOTIFICATIONS")
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending=PendingIntent.getActivity(this,7,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,CHANNEL):new Notification.Builder(this);
        Notification notification=builder.setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("비슷한 습득물을 확인했어요")
            .setContentText("미슈에서 내 분실 신고와 비슷한 물품을 확인해 주세요.").setContentIntent(pending)
            .setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).build();
        try { manager.notify("missu-matches",7,notification);p.edit().putString("last",id).apply(); }
        catch(SecurityException ignored) {}
    }
}
