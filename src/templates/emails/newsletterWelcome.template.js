const { escapeHtml, renderEmailLayout } = require("./shared");

const newsletterWelcomeTemplate = ({ name }) => {
  const safeName = escapeHtml(name || "Beauty Lover");

  const logoUrl = process.env.EMAIL_BRAND_LOGO_URL || "";
  const homepageUrl =
    process.env.FRONTEND_URL_email ||
    process.env.FRONTEND_URL ||
    "https://justgoldcosmetics.com";

  const welcomeHeading =
    process.env.EMAIL_NEWSLETTER_HEADING || "Welcome to the Just Gold Beauty Circle";

  const supportText =
    process.env.EMAIL_NEWSLETTER_SUPPORT ||
    "Need help picking the right products? Our beauty team is ready to guide you.";

  const logoBlock = logoUrl
    ? `<p style="margin:0 0 0;text-align:center;">
        <img src="${escapeHtml(logoUrl)}" alt="Just Gold Cosmetics" style="max-height:44px;width:auto;display:inline-block;" />
       </p>`
    : "";

  const bodyContent = `
    <!-- ===== HEADER GOLD BAR ===== -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#b8973f 0%,#e8c96b 40%,#c9a84c 70%,#8a6820 100%);">
      <tr>
        <td style="padding:28px 40px 22px;text-align:center;">
          ${logoBlock}
          <p style="margin:${logoUrl ? "12px" : "0"} 0 2px;font-family:'Trebuchet MS',Arial,sans-serif;font-size:11px;letter-spacing:4px;color:rgba(255,255,255,0.75);text-transform:uppercase;">Welcome to</p>
          <p style="margin:0 0 4px;font-family:Georgia,'Times New Roman',serif;font-size:34px;font-weight:700;color:#ffffff;letter-spacing:3px;text-shadow:0 2px 8px rgba(0,0,0,0.2);">JUST GOLD</p>
          <p style="margin:0;font-family:'Trebuchet MS',Arial,sans-serif;font-size:12px;letter-spacing:6px;color:rgba(255,255,255,0.85);text-transform:uppercase;">C O S M E T I C S</p>
        </td>
      </tr>
    </table>

    <!-- ===== HERO IMAGE ===== -->
    <table width="100%" cellpadding="0" cellspacing="0" style="position:relative;">
      <tr>
        <td style="padding:0;position:relative;line-height:0;">
          <img src="https://res.cloudinary.com/dvagrhc2w/image/upload/w_auto,dpr_auto,f_auto,q_auto/v1774890031/JG-Mascara_WebBanner.jpg_as4e2u.jpg"
               alt="Just Gold luxury beauty collection"
               style="width:100%;max-width:100%;height:auto;display:block;" />
        </td>
      </tr>
    </table>

    <!-- ===== GOLD DIVIDER ===== -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(90deg,transparent,#c9a84c,transparent);">
      <tr><td style="height:2px;font-size:2px;line-height:2px;">&nbsp;</td></tr>
    </table>

    <!-- ===== MAIN GREETING ===== -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
      <tr>
        <td style="padding:44px 48px 32px;text-align:center;">
          <p style="margin:0 0 10px;font-family:'Trebuchet MS',Arial,sans-serif;font-size:11px;letter-spacing:4px;text-transform:uppercase;color:#b8973f;">Hello, ${safeName}</p>
          <h1 style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:400;color:#1a1208;line-height:1.4;">
            ${escapeHtml(welcomeHeading).replace("Just Gold", "<em style=\"color:#b8973f;font-style:italic;\">Just Gold</em>")}
          </h1>
          <p style="margin:0;font-family:'Trebuchet MS',Arial,sans-serif;font-size:15px;color:#5a4a2a;line-height:1.85;max-width:440px;">
            Thank you for subscribing to Just Gold Cosmetics. You are now among the first to discover limited drops, exclusive offers, and expert beauty tips curated by our team.
          </p>
        </td>
      </tr>
    </table>

    <!-- ===== THREE FEATURE COLUMNS ===== -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-top:1px solid #f0e8d0;border-bottom:1px solid #f0e8d0;">
      <tr>
        <!-- Early Access -->
        <td width="33%" style="padding:28px 16px 24px;text-align:center;vertical-align:top;">
          <img src="https://res.cloudinary.com/dvagrhc2w/image/upload/w_800,f_auto,q_auto/just_gold/products/images/pu6mjkwyyy5yisayhsbd"
               alt="Early access"
               style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid #c9a84c;display:block;margin:0 auto 12px;" />
          <p style="margin:0 0 6px;font-family:'Trebuchet MS',Arial,sans-serif;font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:#b8973f;">Early Access</p>
          <p style="margin:0;font-family:'Trebuchet MS',Arial,sans-serif;font-size:12px;color:#5a4a2a;line-height:1.65;">First to know about limited drops &amp; launches</p>
        </td>
        <!-- Expert Tips -->
        <td width="33%" style="padding:28px 16px 24px;text-align:center;vertical-align:top;border-left:1px solid #f0e8d0;border-right:1px solid #f0e8d0;">
          <img src="https://res.cloudinary.com/dvagrhc2w/image/upload/w_800,f_auto,q_auto/just_gold/products/variants/k4lm9c8fy9bepdlnkwin"
               alt="Expert tips"
               style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid #c9a84c;display:block;margin:0 auto 12px;" />
          <p style="margin:0 0 6px;font-family:'Trebuchet MS',Arial,sans-serif;font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:#b8973f;">Expert Tips</p>
          <p style="margin:0;font-family:'Trebuchet MS',Arial,sans-serif;font-size:12px;color:#5a4a2a;line-height:1.65;">Curated beauty advice from our specialists</p>
        </td>
        <!-- VIP Offers -->
        <td width="33%" style="padding:28px 16px 24px;text-align:center;vertical-align:top;">
          <img src="https://i.postimg.cc/SQL65yFF/Gemini-Generated-Image-199l6z199l6z199l-removebg-preview.png"
               alt="VIP offers"
               style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid #c9a84c;display:block;margin:0 auto 12px;" />
          <p style="margin:0 0 6px;font-family:'Trebuchet MS',Arial,sans-serif;font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:#b8973f;">VIP Offers</p>
          <p style="margin:0;font-family:'Trebuchet MS',Arial,sans-serif;font-size:12px;color:#5a4a2a;line-height:1.65;">Subscriber-only deals &amp; exclusive savings</p>
        </td>
      </tr>
    </table>

    <!-- ===== COUPON SECTION ===== -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
      <tr>
        <td style="padding:36px 40px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#1a1208 0%,#2e2010 50%,#1a1208 100%);border-radius:4px;">
            <tr>
              <td style="padding:40px 32px;text-align:center;">
                <p style="margin:0 0 6px;font-family:'Trebuchet MS',Arial,sans-serif;font-size:10px;letter-spacing:4px;text-transform:uppercase;color:#c9a84c;">A Gift For You</p>
                <p style="margin:0 0 4px;font-family:Georgia,'Times New Roman',serif;font-size:60px;font-weight:700;color:#e8c96b;line-height:1;">15% OFF</p>
                <p style="margin:0 0 28px;font-family:'Trebuchet MS',Arial,sans-serif;font-size:13px;color:rgba(255,255,255,0.6);">on your first order — no minimum spend</p>

                <!-- Dashed coupon box -->
                <table align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
                  <tr>
                    <td style="background:rgba(255,255,255,0.06);border:1.5px dashed #c9a84c;border-radius:4px;padding:14px 36px;text-align:center;">
                      <p style="margin:0 0 4px;font-family:'Trebuchet MS',Arial,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.45);">Your Coupon Code</p>
                      <p style="margin:0;font-family:'Trebuchet MS',Arial,sans-serif;font-size:24px;font-weight:700;letter-spacing:5px;color:#f0d97a;">JUSTGOLD15</p>
                    </td>
                  </tr>
                </table>

                <!-- CTA Button -->
                <table align="center" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="background:linear-gradient(135deg,#b8973f,#e8c96b,#c9a84c);border-radius:2px;">
                      <a href="${escapeHtml(homepageUrl)}"
                         style="display:inline-block;padding:16px 48px;font-family:'Trebuchet MS',Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#1a1208;text-decoration:none;">
                        Shop Now &rarr;
                      </a>
                    </td>
                  </tr>
                </table>

              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- ===== NEW ARRIVALS BANNER ===== -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
      <tr>
        <td style="padding:0 40px 36px;">
          <div style="border-radius:4px;overflow:hidden;position:relative;line-height:0;">
            <img src="https://res.cloudinary.com/dvagrhc2w/image/upload/w_auto,dpr_auto,f_auto,q_auto/v1774890030/JG-SkinFit-Web-banner.jpg_z2tdrr.jpg"
                 alt="New arrivals collection"
                 style="width:100%;max-width:100%;height:180px;object-fit:cover;display:block;" />
          </div>
          <p style="margin:12px 0 0;font-family:'Trebuchet MS',Arial,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#b8973f;text-align:center;">
            <a href="${escapeHtml(homepageUrl)}" style="color:#b8973f;text-decoration:none;">Explore New Arrivals &rarr;</a>
          </p>
        </td>
      </tr>
    </table>

    <!-- ===== SUPPORT NOTE ===== -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf7f0;border-top:1px solid #f0e8d0;">
      <tr>
        <td style="padding:28px 48px;text-align:center;">
          <p style="margin:0;font-family:'Trebuchet MS',Arial,sans-serif;font-size:13px;color:#8a7a5a;line-height:1.75;">
            ${escapeHtml(supportText)}<br/>
            <a href="${escapeHtml(homepageUrl)}/support" style="color:#b8973f;text-decoration:none;border-bottom:1px solid #e8c96b;">Visit our support page &rarr;</a>
          </p>
        </td>
      </tr>
    </table>

    <!-- ===== FOOTER ===== -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1208;">
      <tr>
        <td style="padding:32px 40px;text-align:center;">
          <p style="margin:0 0 4px;font-family:Georgia,'Times New Roman',serif;font-size:16px;letter-spacing:3px;color:#c9a84c;">JUST GOLD COSMETICS</p>
          <a href="${escapeHtml(homepageUrl)}" style="font-family:'Trebuchet MS',Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.4);text-decoration:none;letter-spacing:1px;">www.justgoldcosmetics.com</a>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid rgba(200,160,76,0.2);margin-top:20px;">
            <tr>
              <td style="padding-top:16px;text-align:center;">
                <p style="margin:0;font-family:'Trebuchet MS',Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.3);line-height:1.75;">
                  You're receiving this because you subscribed to Just Gold Cosmetics.<br/>
                  If you did not subscribe, you may safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return renderEmailLayout({
    title: "Welcome to Just Gold Cosmetics",
    preheader: "You're in — enjoy 15% off your first order with code JUSTGOLD15",
    bodyContent,
  });
};

module.exports = {
  newsletterWelcomeTemplate,
};