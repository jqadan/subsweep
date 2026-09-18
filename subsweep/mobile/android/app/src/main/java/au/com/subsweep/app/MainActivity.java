package au.com.subsweep.app;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;

import androidx.core.content.IntentCompat;

import com.getcapacitor.BridgeActivity;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {
    // Matches the server's upload limit, so an oversize file fails here with a
    // clear message instead of after a pointless upload.
    private static final int MAX_BYTES = 5 * 1024 * 1024;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShareIntake.class);
        super.onCreate(savedInstanceState);
        // Cold start from a share: park the file, the web code collects it
        // once it has loaded.
        takeShared(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // Share into an app that is already running (launchMode=singleTask
        // delivers it here): park the file and nudge the web code.
        if (takeShared(intent) && getBridge() != null) {
            getBridge().triggerWindowJSEvent("subsweepShare");
        }
    }

    /**
     * Reads the shared statement into ShareIntake's pending slot. Returns true
     * when the intent carried a file, whether or not reading it succeeded —
     * the web side is told either way.
     */
    private boolean takeShared(Intent intent) {
        if (intent == null) return false;
        Uri uri = null;
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            uri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
        } else if (Intent.ACTION_VIEW.equals(intent.getAction())) {
            uri = intent.getData();
        }
        if (uri == null) return false;

        // Consume the intent so a recreated activity does not upload it twice.
        intent.setAction(Intent.ACTION_MAIN);
        intent.removeExtra(Intent.EXTRA_STREAM);
        intent.setData(null);

        ShareIntake.pendingName = displayName(uri);
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) throw new java.io.IOException("no stream");
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[16 * 1024];
            int n;
            while ((n = in.read(chunk)) != -1) {
                buf.write(chunk, 0, n);
                if (buf.size() > MAX_BYTES) {
                    ShareIntake.pendingError = "That file is over 5 MB. Export a shorter date range and share it again.";
                    return true;
                }
            }
            ShareIntake.pendingText = buf.toString(StandardCharsets.UTF_8.name());
        } catch (Exception e) {
            ShareIntake.pendingError = "Couldn't read \"" + ShareIntake.pendingName
                + "\" from the app that shared it. Save it to Downloads and choose it from there instead.";
        }
        return true;
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String name = c.getString(0);
                if (name != null && !name.isEmpty()) return name;
            }
        } catch (Exception ignored) {
            // Some providers refuse metadata queries; the fallback name is fine.
        }
        String last = uri.getLastPathSegment();
        return last != null && !last.isEmpty() ? last : "statement.csv";
    }
}
