package app.hermes.companion;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "SecureStorage")
public class SecureStoragePlugin extends Plugin {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "hermes_gateway_token";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final String PREFS = "hermes_secure_storage";
    private static final String TOKEN = "gateway_token";
    private static final String ADMIN_KEY = "model_admin_key";

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        if (!store.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
            generator.init(new KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(KEY_ALIAS, null);
    }

    @PluginMethod
    public void setToken(PluginCall call) {
        store(call, TOKEN);
    }

    @PluginMethod
    public void getToken(PluginCall call) {
        read(call, TOKEN);
    }

    @PluginMethod
    public void setAdminKey(PluginCall call) {
        store(call, ADMIN_KEY);
    }

    @PluginMethod
    public void getAdminKey(PluginCall call) {
        read(call, ADMIN_KEY);
    }

    private void store(PluginCall call, String name) {
        String value = call.getString("value", "");
        if (value.isEmpty()) {
            preferences().edit().remove(name).apply();
            call.resolve();
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key());
            String iv = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP);
            String encrypted = Base64.encodeToString(
                    cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            preferences().edit().putString(name, iv + ":" + encrypted).apply();
            call.resolve();
        } catch (Exception error) {
            call.reject("Unable to protect the secret", error);
        }
    }

    private void read(PluginCall call, String name) {
        String stored = preferences().getString(name, "");
        JSObject result = new JSObject();
        if (stored.isEmpty()) {
            result.put("value", "");
            call.resolve(result);
            return;
        }
        try {
            String[] parts = stored.split(":", 2);
            if (parts.length != 2) throw new IllegalArgumentException("Invalid secret payload");
            byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
            byte[] encrypted = Base64.decode(parts[1], Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            result.put("value", new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8));
            call.resolve(result);
        } catch (Exception error) {
            preferences().edit().remove(name).apply();
            call.reject("Stored secret is invalid", error);
        }
    }
}
