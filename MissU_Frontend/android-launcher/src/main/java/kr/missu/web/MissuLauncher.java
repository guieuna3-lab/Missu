package kr.missu.web;

import android.net.Uri;
import com.google.androidbrowserhelper.trusted.LauncherActivity;

public final class MissuLauncher extends LauncherActivity {
    @Override
    protected Uri getLaunchingUrl() {
        // 외부 앱이 다른 주소를 전달해도 미슈 운영 주소에서 시작한다.
        return Uri.parse(getString(R.string.web_url));
    }
}
