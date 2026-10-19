package com.blackdotorigin.financeflow;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.math.BigDecimal;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "UpiPayments")
public class UpiPaymentsPlugin extends Plugin {
    private static final Pattern STATUS_PATTERN =
        Pattern.compile("(?:^|[&;,])\\s*status\\s*=\\s*([^&;,]*)", Pattern.CASE_INSENSITIVE);

    @PluginMethod
    public void openPayment(PluginCall call) {
        String payeeUpiId = call.getString("payeeUpiId", "").trim();
        String payeeName = call.getString("payeeName", "").trim();
        String amountValue = call.getString("amount", "").trim();
        String note = call.getString("note", "").trim();

        if (!payeeUpiId.matches("[^@\\s]+@[^@\\s]+")) {
            call.reject("Enter a valid UPI ID before starting a payment.");
            return;
        }

        final BigDecimal amount;
        try {
            amount = new BigDecimal(amountValue);
        } catch (NumberFormatException exception) {
            call.reject("The payment amount is invalid.");
            return;
        }
        if (amount.signum() <= 0 || amount.scale() > 2) {
            call.reject("UPI payments require a positive amount with no more than two decimal places.");
            return;
        }

        Uri paymentUri = new Uri.Builder()
            .scheme("upi")
            .authority("pay")
            .appendQueryParameter("pa", payeeUpiId)
            .appendQueryParameter("pn", payeeName.isEmpty() ? payeeUpiId : payeeName)
            .appendQueryParameter("am", amount.stripTrailingZeros().toPlainString())
            .appendQueryParameter("cu", "INR")
            .appendQueryParameter("tn", note.isEmpty() ? "FinanceFlow due" : note)
            .build();
        Intent paymentIntent = new Intent(Intent.ACTION_VIEW, paymentUri);

        try {
            startActivityForResult(
                call,
                Intent.createChooser(paymentIntent, "Pay with"),
                "paymentResultCallback"
            );
        } catch (ActivityNotFoundException exception) {
            call.reject("No compatible UPI payment app is installed.");
        } catch (Exception exception) {
            call.reject("Could not open a UPI payment app.", exception);
        }
    }

    @ActivityCallback
    public void paymentResultCallback(PluginCall call, ActivityResult result) {
        if (call == null) return;

        Intent data = result.getData();
        String response = data == null ? null : data.getStringExtra("response");
        if ((response == null || response.isEmpty()) && data != null) {
            Uri responseUri = data.getData();
            if (responseUri != null) {
                response = responseUri.getQueryParameter("response");
                if (response == null || response.isEmpty()) {
                    response = responseUri.getEncodedQuery();
                }
            }
        }
        if ((response == null || response.isEmpty()) && data != null) {
            response = data.getStringExtra("Status");
        }

        JSObject resultData = new JSObject();
        resultData.put("status", parseReportedStatus(response));
        call.resolve(resultData);
    }

    private String parseReportedStatus(String response) {
        if (response == null || response.isEmpty()) return "UNKNOWN";

        Matcher matcher = STATUS_PATTERN.matcher(response);
        String status = matcher.find() ? matcher.group(1).trim().toUpperCase(Locale.ROOT) : "";
        switch (status) {
            case "SUCCESS":
                return "SUCCESS";
            case "FAILURE":
            case "FAILED":
                return "FAILURE";
            case "SUBMITTED":
            case "PENDING":
                return "PENDING";
            case "CANCELLED":
            case "CANCELED":
                return "CANCELLED";
            default:
                return "UNKNOWN";
        }
    }
}
