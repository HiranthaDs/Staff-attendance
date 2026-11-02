import "server-only";

type EmailDelivery = {
  sent: boolean;
  configured: boolean;
  error?: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] || character);
}
function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

async function sendEmail(input: { to: string; subject: string; html: string; text: string }): Promise<EmailDelivery> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) return { sent: false, configured: false, error: "Email delivery is not configured." };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, html: input.html, text: input.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error("Presence email delivery failed", { status: response.status });
      return { sent: false, configured: true, error: "The email provider rejected the message." };
    }
    return { sent: true, configured: true };
  } catch {
    console.error("Presence email delivery failed unexpectedly");
    return { sent: false, configured: true, error: "The email provider could not be reached." };
  }
}

function credentialsEmail(input: {
  fullName: string;
  email: string;
  temporaryPassword: string;
  reset: boolean;
}) {
  const loginLink = `${appUrl()}/login?email=${encodeURIComponent(input.email)}`;
  const safeName = escapeHtml(input.fullName);
  const safeEmail = escapeHtml(input.email);
  const safePassword = escapeHtml(input.temporaryPassword);
  const heading = input.reset ? "Your temporary password is ready" : "Welcome to Presence";
  const intro = input.reset
    ? "Your administrator reset your Presence password. Use the temporary password below to sign in."
    : "Your office attendance account is ready. Here are your secure sign-in details.";
  const subject = input.reset ? "Your Presence temporary password" : "Welcome to Presence - your account is ready";
  const text = `${heading}\n\nHi ${input.fullName},\n\n${intro}\n\nSign in: ${loginLink}\nUsername: ${input.email}\nTemporary password: ${input.temporaryPassword}\n\nYou will be required to choose a new password after signing in.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f7f5;font-family:Arial,sans-serif;color:#17352f"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" style="max-width:580px;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 16px 40px rgba(13,73,61,.12)"><tr><td style="padding:30px;background:linear-gradient(135deg,#073f36,#087565);color:#fff"><div style="font-size:13px;font-weight:800;letter-spacing:.16em;color:#d8ff63">PRESENCE</div><h1 style="margin:10px 0 0;font-size:28px">${heading}</h1></td></tr><tr><td style="padding:30px"><p style="font-size:16px;line-height:1.65;margin-top:0">Hi ${safeName},</p><p style="font-size:15px;line-height:1.65">${intro}</p><div style="margin:24px 0;padding:20px;border-radius:16px;background:#f3f7f5;border:1px solid #dce9e5"><div style="margin-bottom:14px"><small style="display:block;color:#648078">USERNAME / EMAIL</small><strong style="font-size:16px">${safeEmail}</strong></div><div><small style="display:block;color:#648078">TEMPORARY PASSWORD</small><strong style="font-family:monospace;font-size:18px;letter-spacing:.04em">${safePassword}</strong></div></div><a href="${loginLink}" style="display:inline-block;padding:14px 22px;border-radius:12px;background:#0d493d;color:#fff;text-decoration:none;font-weight:700">Open Presence and sign in</a><p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#648078">For your security, Presence will ask you to replace this temporary password immediately after sign-in. Do not forward this email.</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, html, text };
}

export function sendWelcomeEmail(input: { fullName: string; email: string; temporaryPassword: string }) {
  return sendEmail({ to: input.email, ...credentialsEmail({ ...input, reset: false }) });
}

export function sendPasswordResetEmail(input: { fullName: string; email: string; temporaryPassword: string }) {
  return sendEmail({ to: input.email, ...credentialsEmail({ ...input, reset: true }) });
}

export function sendInvitationEmail(input: {
  fullName: string;
  email: string;
  organizationName: string;
  invitationLink: string;
  loginLink: string;
  roleLabel: string;
  expiresAt: string;
}) {
  const safeName = escapeHtml(input.fullName);
  const safeOrganization = escapeHtml(input.organizationName);
  const safeRole = escapeHtml(input.roleLabel);
  const safeLink = escapeHtml(input.invitationLink);
  const safeLoginLink = escapeHtml(input.loginLink);
  const expiry = new Intl.DateTimeFormat("en-LK", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Colombo" }).format(new Date(input.expiresAt));
  const subject = `Join ${input.organizationName} on Presence`;
  const text = `Hi ${input.fullName},\n\nYou have been invited to join ${input.organizationName} as ${input.roleLabel}.\n\nOne-time account activation: ${input.invitationLink}\nCompany sign-in after activation: ${input.loginLink}\n\nThe private activation link expires ${expiry}.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f7f5;font-family:Arial,sans-serif;color:#17352f"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" style="max-width:580px;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 16px 40px rgba(13,73,61,.12)"><tr><td style="padding:30px;background:linear-gradient(135deg,#073f36,#087565);color:#fff"><div style="font-size:13px;font-weight:800;letter-spacing:.16em;color:#d8ff63">PRESENCE · ${safeOrganization}</div><h1 style="margin:10px 0 0;font-size:28px">Your workspace invitation</h1></td></tr><tr><td style="padding:30px"><p style="font-size:16px;line-height:1.65;margin-top:0">Hi ${safeName},</p><p style="font-size:15px;line-height:1.65">You have been invited to join <strong>${safeOrganization}</strong> as <strong>${safeRole}</strong>.</p><a href="${safeLink}" style="display:inline-block;margin:14px 0;padding:14px 22px;border-radius:12px;background:#0d493d;color:#fff;text-decoration:none;font-weight:700">Activate my account</a><p style="font-size:13px;line-height:1.6;color:#648078">This private activation link works once and expires ${escapeHtml(expiry)}. Do not forward it.</p><div style="margin-top:20px;padding:16px;border-radius:14px;background:#f3f7f5"><small style="display:block;color:#648078">PERMANENT ${safeOrganization.toUpperCase()} SIGN-IN</small><a href="${safeLoginLink}" style="display:block;margin-top:6px;color:#0d493d;word-break:break-all">${safeLoginLink}</a></div></td></tr></table></td></tr></table></body></html>`;
  return sendEmail({ to: input.email, subject, html, text });
}
