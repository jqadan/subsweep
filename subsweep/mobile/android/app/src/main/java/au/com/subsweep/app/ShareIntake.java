package au.com.subsweep.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Hands a statement shared into the app ("Share to SubSweep" from the bank
 * app, Files, Gmail…) over to the web code. MainActivity reads the file the
 * moment the intent arrives, while the sender's read grant is still valid,
 * and parks the text here; the web side calls consume() to collect it — on
 * start-up for a cold launch, or when MainActivity fires the subsweepShare
 * window event for a share into an app that is already running.
 *
 * Nothing is written to disk: the content resolver stream is read straight
 * into memory and the text goes to the server as the request body.
 */
@CapacitorPlugin(name = "ShareIntake")
public class ShareIntake extends Plugin {
    static String pendingName;
    static String pendingText;
    static String pendingError;

    @PluginMethod
    public void consume(PluginCall call) {
        JSObject ret = new JSObject();
        if (pendingError != null) {
            ret.put("error", pendingError);
        } else if (pendingText != null) {
            ret.put("name", pendingName);
            ret.put("text", pendingText);
        }
        pendingName = null;
        pendingText = null;
        pendingError = null;
        call.resolve(ret);
    }
}
