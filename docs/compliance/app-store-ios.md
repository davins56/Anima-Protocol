# Anima Protocol: App Store compliance for the native iOS shell

Status: research and checklist, not legal advice. Prepared 2026-10-22 for Dàvīn (davins56).
Branch: `docs/app-store-compliance` (local only, not pushed).

Apple's App Review Guidelines were last updated **October 16, 2026**, and that revision matters for this app. Guideline 1.2 now names "AI content creation apps" and "nonconsensual intimate imagery", and the hidden-features rule moved from 2.3.1 into a new **2.5.19**. All guideline quotes below come from that version:
<https://developer.apple.com/app-store/review/guidelines/> ("Last Updated: October 16, 2026").

Anything marked **[Context, not Apple policy]** is a legal or regulatory obligation outside the App Store. It is included only so it is not missed. Confirm it with counsel.

---

## 0. TL;DR: what decides approval

1. **Explicit sexual content cannot ship in the iOS app at any age rating.** Apple's questionnaire maps "Graphic Sexual Content and Nudity" to **Unrated**, and "An Unrated app can't be published on the App Store." The highest publishable rating is **18+**, which allows "Frequent sexual content or nudity". Apple defines that as "*Non-explicit* depictions of sexual behavior, including brief or partial nudity." Guideline 1.1.4 also bans "Overtly sexual or pornographic material." The current web **Adult Content Mode** ("Enables explicit, lewd, and sexual roleplay") therefore has to be **absent from, or unreachable in, the iOS build**. A self-attested 18+ toggle does not change this.
2. **The 1.2 "turn it on via your website" exception is narrow.** It covers "*incidental* mature 'NSFW' content" in "user-generated content from a web-based service", "hidden by default". In this app, adult mode is a core feature: AI output generated for the requesting user, not incidental UGC. Relying on that sentence to serve explicit chat or images inside the app is a high rejection and removal risk (see §3.4).
3. **The photo generator is now squarely in scope of the Oct 2026 1.2 update.** The generator is identity-locked and uses user-uploaded reference images. Apple says nonconsensual intimate imagery, "including imagery generated using AI tools", is content "apps must proactively prevent and remove". The app needs filtering, reporting, blocking and published contact information, plus real-person likeness and consent controls.
4. **No bait-and-switch.** Under 2.5.19, plus Apple's Oct 16 news post, adding features after review that were not in the reviewed build can get the app removed and the developer account terminated. A WebView shell whose server later serves different content (for example, enabling explicit mode for iOS users after approval) is exactly the pattern Apple describes. The iOS content tier has to be enforced **server-side and documented in Review Notes**.
5. **A thin WebView wrapper risks 4.2.** The app needs "features, content, and UI that elevate it beyond a repackaged website." Today the only native code is an App Intents stub. No Xcode or Capacitor project exists yet (§1).
6. **5.1.2(i) now names third-party AI explicitly.** "You must clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission before doing so." The current privacy policy only lists Stripe and hosting providers. It does not list OpenAI, xAI, fal, Google Gemini, OpenRouter or ElevenLabs, which the server code uses.
7. **Payments.** Any premium unlock or subscription sold inside the iOS app must use IAP (3.1.1). The privacy policy references Stripe, and the web build has Stripe client stubs.
8. **Login.** The web app uses Clerk with GitHub OAuth and email code. Under 4.8, a third-party or social login used for the primary account requires an equivalent privacy-preserving option, typically Sign in with Apple.
9. **In-app account deletion** is required (5.1.1(v)). The current "Delete account" handler deletes app entities client-side and signs out. I found no call that deletes the Clerk user or the server profile, storage objects or generated photos.

---

## 1. What exists in the repo today (verified 2026-10-22)

Searched all local branches with `git grep` for `capacitor`, `ios`, `expo`, `react-native`, `wkwebview`, `xcode`, plus age, NSFW, moderation and report/block terms.

| Area | Finding | Location |
|---|---|---|
| Native iOS shell | **No iOS app project exists.** There is no Xcode project, `capacitor.config.*`, `@capacitor/*` dependency, Expo or React Native setup. The only native code is a Swift **App Intents stub** ("Stub App Intents for a Capacitor-wrapped Anima build. Not compiled by the web build."). It defines `TalkToCompanionIntent`, `OpenResonanceIntent`, `ShowVesselIntent` and an `AppShortcutsProvider`. Each intent calls `UIApplication.shared.open(https://anima-protocol.com/...)`, which opens Safari unless universal links are configured. | `ios/AnimaIntents/SerenityIntents.swift` (added in 3ac1c8f) |
| Existing App Store notes | `artifacts/anima-protocol/public/app-store-requirements.md` claims "COPPA Compliance (13+ with parental controls for 13-17)", "External URL handling via Capacitor", "Sexual Content: Yes (can be disabled)" and "No IAP required". **Most of these claims are inaccurate against the code** (no Capacitor config, no parental controls found, Stripe referenced, explicit content not permissible). The file is also served publicly from `public/`. Treat it as superseded by this document. | `artifacts/anima-protocol/public/app-store-requirements.md` |
| Adult mode toggle | Settings → "Content Rating" → **"18+ Adult Content Mode"**. Copy: "Enables explicit, lewd, and sexual roleplay… By enabling this you confirm you are 18 years of age or older." The confirm dialog is "I Am 18+ — Enable". This is self-attestation only and writes `adult_content_enabled` to profile settings. | `artifacts/anima-protocol/src/pages/Settings.jsx` (~L878–915, ~L1335–1360) |
| Server adult gating | `adultActive = !therapyActive && (profileSettings.adult_content_enabled === true \|\| body.metadata?.adult_mode === true)`. **The client can enable adult mode per request by sending `metadata.adult_mode: true`, even if the profile setting is off.** The intimacy engine (`intimacyEngine.ts`, `intimacyPrompt.ts`, `routes/intimacy.ts`) runs when `adultActive`. Env `NSFW_INTENSITY` exists. | `artifacts/api-server/src/routes/chat.ts` ~L2948; same logic bundled in `api/index.mjs` |
| Age verification | `AgeVerificationGate.jsx` (DOB entry, under-13 block, `isAdult` flag) exists but is **not imported anywhere**, so it is dead code. No server-side DOB, age or verification fields were found. `AIDisclaimerModal` (AI disclosure, "AI systems can produce inaccurate…") is shown once, tracked in localStorage. | `artifacts/anima-protocol/src/components/legal/` |
| Image safety | fal results with `has_nsfw_concepts[0]` are rejected ("blocked by the safety filter"). The Kontext path sets `safety_tolerance: "2"`. The LoRA path sets `enable_safety_checker: true`. The **PuLID (identity-reference) path sets no safety flag explicitly**, so it relies on the provider default. The Gemini path relies on Google's built-in filtering. **No consent or likeness check on reference image uploads.** | `artifacts/api-server/src/lib/photo/{generatePhoto,providerRouter}.ts`, `routes/photo.ts` |
| Report / block | **No report-content or block-user UI or endpoint found** for AI messages, images or user-created nodes and characters. | — |
| Crisis handling | `detectCompanionCrisis` emits a `crisis_resource` card. Therapy mode has `assessTherapySafety`. | `routes/chat.ts`, `lib/therapySafety.ts` |
| Account deletion | `handleDeleteAccount` deletes ChatSession, Character, memories, inventory and similar entities, clears localStorage, then logs out. **No Clerk user deletion or server-side profile, storage or photo purge was found.** | `artifacts/anima-protocol/src/pages/Settings.jsx` ~L292 |
| Login | Clerk: email code and **GitHub OAuth** (`oauth_github`). No Sign in with Apple. | `artifacts/anima-protocol/src/ProtocolApp.jsx`, `components/auth/` |
| Payments | `GetStripeLifetimePrices` client stub. The privacy policy says "Stripe (payments)". No StoreKit or RevenueCat. | `src/api/base44Client.d.ts`, `public/privacy-policy.html` |
| Privacy policy third parties | "We do NOT share your personal data with third parties except: Service Providers: Stripe (payments), hosting providers…". **AI providers are not named.** Server code and `.env.example` use OpenAI, OpenRouter, Gemini, fal (`FAL_KEY`), xAI Grok Voice (`XAI_API_KEY`) and ElevenLabs. | `artifacts/anima-protocol/public/privacy-policy.html` L96–100 |
| Push | Web Push (`web-push`, `push_subscriptions`, `push-notifications-sw.js`). There is no APNs path. | `artifacts/api-server/src/lib/proactiveMessages.ts` |
| Location | Resonance encounters accept `geo_lat`/`geo_lng`. | `artifacts/api-server/src/routes/resonance.ts` |
| Repo hygiene | Root `anima-protocol.py` is an explicit sexual simulation script gated by `ADULT_MODE_ENABLED`. It is not part of the web bundle, but **it must never ship inside an iOS bundle**, and reviewers who see the public repo may notice it. | `anima-protocol.py` |

---

## 2. Requirements by area, with the exact text relied on

### 2.1 Objectionable content (1.1) and user/AI-generated content (1.2)

- **1.1.4**: "Overtly sexual or pornographic material, defined as 'explicit descriptions or displays of sexual organs or activities intended to stimulate erotic rather than aesthetic or emotional feelings.' This includes 'hookup' apps and other apps that may include pornography…" This applies to text as well as images ("explicit **descriptions**"), so it covers explicit roleplay chat and voice, not only pictures.
- **1.1** (lead): "Apps should not include content that is offensive, insensitive, upsetting, intended to disgust, in exceptionally poor taste, or just plain creepy."
- **1.2**: "Apps that enable users to create, generate, upload, share, or otherwise contribute content present particular challenges, including intellectual property infringement, nonconsensual intimate imagery, and anonymous bullying. This includes social media, user-generated content platforms, and **AI content creation apps**. To prevent abuse, such apps must include:
  - A method for filtering objectionable material from being posted to the app
  - A mechanism to report offensive content and timely responses to concerns
  - The ability to block abusive users from the service
  - Published contact information so users can easily reach you"
- **1.2**: "Apps with user-generated content or services that end up being used **primarily for pornographic content**, … objectification of real people … do not belong on the App Store and may be removed without notice. If your app includes user-generated content from a web-based service, it may display incidental mature 'NSFW' content, provided that the content is hidden by default and only displayed when the user turns it on via your website."
- **1.2**: "Developers who fail to implement appropriate safeguards or fail to remediate identified violations after notice may be considered in violation of the Developer Code of Conduct… Egregious or repeated behavior is grounds for immediate removal of your app from the App Store, and from the Apple Developer Program."
- Apple news, Oct 16 2026 (<https://developer.apple.com/news/?id=vvzx6cul>): "pornographic material has long been prohibited on the App Store — this includes apps that generate nudity or sexually explicit imagery, such as 'nudification' apps…" and "1.2: Content moderation requirements now explicitly cover nonconsensual intimate imagery — including imagery generated using AI tools — as content that apps must proactively prevent and remove from their platforms."
- **4.7 / 4.7.1** (chatbots and software not embedded in the binary): "Apps may offer certain software that is not embedded in the binary, specifically HTML5 and JavaScript mini apps and mini games, streaming games, **chatbots**, and plug-ins… You are responsible for all such software offered in your app…" 4.7.1: such software must "include a method for filtering objectionable material, a mechanism to report content and timely responses to concerns, and the ability to block abusive users". **4.7.5**: "Your app must provide a way for users to identify software that exceeds the app's age rating, and use an age restriction mechanism based on verified or declared age to limit access by underage users." Whether App Review treats first-party companions as 4.7 "chatbots" is an interpretation question. Building to 4.7.1 and 4.7.5 anyway costs little and covers both readings.
- **1.2.1(a)** (creator content): "Creator apps must provide a way for users to identify content that exceeds the app's age rating, and use an age restriction mechanism based on verified or declared age to limit access by underage users." This is relevant if user-made characters or nodes are ever shared between users.
- **1.4 / 1.4.1** are relevant to "therapy mode". Medical apps "may be reviewed with greater scrutiny" and "should remind users to check with a doctor". Avoid presenting companions as treatment.

**Applying this to Anima (text, image and voice):**

| Surface | What App Review will expect in the iOS app |
|---|---|
| Companion chat (text) | No explicit sexual descriptions (1.1.4). Server-side content filter on model output for the iOS tier. In-message **Report** (per message) with a working backend queue and "timely responses". Crisis resources (already present). |
| Voice (Grok Voice realtime) | Same content tier as text, enforced in the voice agent's system policy and with output moderation of transcripts. 2.5.14: "Apps must request explicit user consent and provide a clear visual and/or audible indication when recording… This includes any use of the device… microphone". Report must work on voice sessions too, for example "report last response". |
| Photo generator | Non-explicit only. A provider safety checker on **every** path, including PuLID. A server-side post-generation image classifier. Block nudity and sexualized prompts in the iOS tier. **Real-person likeness controls**: reference uploads must be the user's own likeness or a fictional or licensed one, with an attestation and a takedown flow (NCII, 1.2). Never accept "make X nude" or "in underwear" style edits of uploaded photos. Report on every image. |
| User-created characters, resonance nodes, "global" nodes, PDFs | If visible to other users: filter, report, block user, moderation queue. If strictly private: still filter and report, because 1.2 covers "AI content creation apps" even without sharing. |
| Block | With no human-to-human interaction, "block abusive users" applies mainly to any shared or global content authors. Implement block-user for any author whose content can reach another user. For private-only AI chat, offer "hide/stop this companion" and document in Review Notes why user-to-user blocking is N/A. |
| Contact info | Published support email and URL in-app and in App Store Connect (1.2, 1.5). |

**AI-image labeling: what Apple does and does not require**

- **The App Review Guidelines contain no explicit rule requiring AI-generated images to be labeled or watermarked.** I checked the full Oct 16, 2026 text.
- Apple's **Human Interface Guidelines → Generative AI** (design guidance, not a review rule) say: "Communicate where your app uses AI… **Never trick someone into thinking they're interacting with or viewing content authored by a human if they're actually interacting with AI.** Ensure your approach to disclosure aligns with any regulations in the regions where you offer your app." <https://developer.apple.com/design/human-interface-guidelines/generative-ai/>
- 2.3.1(a) and 2.3 (accurate metadata) and 5.6 (no misleading practices) indirectly push toward clear disclosure.
- **[Context, not Apple policy]**
  - **EU AI Act Art. 50.** Transparency obligations apply from 2 Aug 2026. Deployers must disclose deepfakes, and providers must mark synthetic output in a machine-readable way. Per the Commission FAQ and law-firm summaries, the provider-side marking obligation was deferred to 2 Dec 2026 for systems already on the market. Verify with counsel. <https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act>
  - **C2PA Content Credentials** is a practical way to meet machine-readable marking (an industry standard, not legally mandated by Apple).
  - **California SB 243 (Companion Chatbots, Bus. & Prof. Code §22601 et seq., effective Jan 1 2026).** It requires a clear "not human" notice where a reasonable person could be misled, and a published suicide and self-harm protocol. For users the operator *knows* are minors, it requires AI disclosure, 3-hourly break reminders, and "reasonable measures to prevent its companion chatbot from producing visual material of sexually explicit conduct". <https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?chapter=22.6&division=8.&lawCode=BPC>
  - **Texas App Store Accountability Act (SB 2420).** As of Jul 6 2026 the Supreme Court declined to reinstate the injunction, so it is currently enforceable pending appeal. It drives Apple's age-category sharing via Declared Age Range. <https://www.scotusblog.com/2026/07/supreme-court-allows-texas-to-enforce-law-requiring-age-verification-and-parental-consent-on-app/>
  - **Utah's equivalent law** is reported as delayed to May 2027 (secondary source; verify).

### 2.2 Thin wrapper, spam and minimum functionality (4.2, 4.3, 2.5.2, 4.7)

- **4.2**: "Your app should include features, content, and UI that elevate it beyond a repackaged website. If your app is not particularly useful, unique, or 'app-like,' it doesn't belong on the App Store."
- **4.2.2**: "Other than catalogs, apps shouldn't primarily be marketing materials, advertisements, web clippings, content aggregators, or a collection of links."
- **4.2.1**: "Apps using ARKit should provide rich and integrated augmented reality experiences; merely dropping a model into an AR view or replaying animation is not enough."
- **4.2.6**: "Apps created from a commercialized template or app generation service will be rejected unless they are submitted directly by the provider of the app's content." This matters if any part of the shell comes from a no-code or app-generator wrapper service.
- **4.3(b)**: "Don't submit apps that are indistinguishable from what's already widely available… Certain kinds of apps, such as dating… are well established on the App Store and we will not accept new submissions unless they offer a meaningfully different or improved experience." AI companion apps are a crowded category. The persistent memory, vessel and resonance concepts are the differentiation to emphasize in metadata and Review Notes.
- **4.3(a)**: "Don't create multiple Bundle IDs of the same app". Do not ship separate "SFW" and "18+" variants of the same app.
- **2.5.2**: Apps "may not download, install, or execute code which introduces or changes features or functionality of the app". **4.7** explicitly allows "HTML5 and JavaScript mini apps… chatbots" not embedded in the binary, but **4.7.2**: "Your app may not extend or expose native platform APIs or technologies to the software without prior permission from Apple." Keep the Capacitor bridge to a minimal, first-party plugin allow-list, and do not expose general-purpose native bridges to remote JS.
- **2.5.6**: "Apps that browse the web must use the appropriate WebKit framework and WebKit JavaScript." WKWebView or Capacitor is fine.
- **2.5.11** (SiriKit and Shortcuts): "Resolve the Siri request or Shortcut in the most direct way possible…" The current intents bounce to Safari via `UIApplication.shared.open(https://…)`. They should route **inside the app** via a universal link or in-app router.
- **2.5.16**: "Widgets, extensions, and notifications should be related to the content and functionality of your app."
- **4.5.4**: "Push Notifications must not be required for the app to function… should not be used for promotions… unless customers have explicitly opted in…" Proactive companion messages need opt-in, and they must not carry intimate content in the notification body (lock-screen exposure; 4.5.4 "should not be used to send sensitive personal or confidential information").

**Native features that add real value (recommended minimum set, in priority order):**

1. **Native realtime voice**: AVAudioSession (`.playAndRecord`, `.voiceChat` mode), echo cancellation, route handling (AirPods), interruption handling, background audio for in-progress calls (2.5.4 allows "audio playback" and "VoIP" for intended purposes), and optionally CallKit-style call UI. Use the existing ephemeral-token pattern. Never put API keys in the app.
2. **APNs push** for proactive companion messages. The current Web Push path cannot deliver inside WKWebView. Use a neutral notification body (e.g. "Serenity sent you a message").
3. **App Intents / Siri / Shortcuts** (finish `SerenityIntents.swift`): talk to companion, open resonance, show vessel, routed in-app.
4. **Widgets / Live Activities**: companion mood or "thinking of you" widget, and a Live Activity for an active voice call. They must stay SFW (2.5.16, 2.3.8 spirit).
5. **Native photo flows**: PHPicker for reference images (5.1.1(iii): "use the out-of-process picker or a share sheet rather than requesting full access"), a native share sheet and save-to-Photos for generated images (add-only permission).
6. **Haptics** tied to companion affect and resonance tuning.
7. **Offline memory cache**: read-only cached chat history, memory and identity in on-device storage (SwiftData or SQLite via a Capacitor plugin), so the app opens and shows history without network.
8. **ARKit / RealityKit vessel viewing (optional)**: only if it is a rich experience (4.2.1), for example a placed vessel that reacts to voice and affect. A static model drop will not satisfy 4.2.1.
9. **Sign in with Apple** (required if GitHub OAuth stays; see 2.5) and **Face ID app lock** via LocalAuthentication (2.5.13) for privacy of intimate conversations.
10. **Declared Age Range** integration (see 2.3), which is native-only by definition.

What reviewers look for: the app launches into a native-feeling experience, not a website with browser chrome or "open in Safari" detours. It needs native navigation and gestures, works offline or degraded, has no web login dead-ends, and uses features that need the device (voice, push, widgets, Siri, photos). Its Review Notes must clearly explain the non-obvious features (2.3.1(a): "All new features, functionality, and product changes must be described with specificity in the Notes for Review section").

### 2.3 Age rating, age gating and mature AI imagery

**Rating system (App Store Connect Help, "Age ratings values and definitions")**: <https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/>

- Ratings are now **4+, 9+, 13+, 16+, 18+** (Apple news, Jul 24 2025: <https://developer.apple.com/news/?id=ks775ehf>).
- **18+** may contain "Sexuality or Nudity: Frequent sexual content or nudity". **Sexual Content or Nudity** is defined as "**Non-explicit** depictions of sexual behavior, including brief or partial nudity. May include: mild romantic intimacy, implied sexual activity, or erotic or sensual dialog."
- **16+** includes "Frequent mature or suggestive themes". **13+** includes "Infrequent sexual content or nudity".
- **Unrated**: "Graphic Sexual Content and Nudity: Explicit, detailed depictions of sexual activity or nudity. May include: uncensored or full-frontal nudity; realistic, illustrative, or pornographic portrayals of sex." Also: "**An Unrated app can't be published on the App Store.**"
- Questionnaire **In-App Controls** include "Age Assurance: … declared age range API; age estimation capabilities; age verification via government-issued…" and "Parental Controls". **Capabilities** include "User-Generated Content", "Messaging and Chat", "Social Media" and "Unrestricted Web Access" (the last is 16+).
- Apple news, Jul 24 2025: "you must consider how all app features, **including AI assistants and chatbot functionality**, impact the frequency of sensitive content appearing within your app to make sure it receives the appropriate rating." It also says you "can set a higher age rating" to reflect a minimum-age policy.
- Apple news, Jul 9 2026 (<https://developer.apple.com/news/?id=tlur8uvi>): the social media questions are **required for new apps and updates from September 2026**.
- **2.3.6**: "Answer the age rating questions in App Store Connect honestly… If your app is mis-rated, customers might be surprised by what they get, or it could trigger an inquiry from government regulators."
- **2.3.8**: "make sure your app and in-app purchase icons, screenshots, and previews adhere to a **4+ age rating even if your app is rated higher**." Store screenshots must not show intimate or suggestive companion images.

**Declared Age Range API** (<https://developer.apple.com/support/age-assurance>; docs <https://developer.apple.com/documentation/declaredagerange/requesting-people-share-their-age-range-with-your-app>):

- "Ask people to share their age range so you can create age-appropriate experiences". It is available worldwide. As of iOS 26.2 it also reports the method used (`selfDeclared`, `guardianDeclared`, `paymentChecked`, `governmentIDChecked`, …) and `isEligibleForAgeFeatures`. As of 26.4 it adds `requiredRegulatoryFeatures` and significant-update acknowledgement. Build against the iOS 26.2+ SDK and Xcode 26.2+.
- "**If my app is rated 18+, do I still need to implement the Declared Age Range API?** Yes. In regions where legally required, you need to check the age of the people using your app with the Declared Age Range API."
- "**Am I responsible for age restrictions or is Apple?** Yes, developers are responsible for their own age restrictions."
- Parental consent revocation: "When a parent or guardian revokes consent… Apple will prevent the app from launching. To handle consent revocations, use the `RESCIND_CONSENT` value…" via App Store Server Notifications.

**Hidden or changed features after review (task item "2.3.1")**

- This rule moved. **2.5.19** (new Oct 2026): "Don't include any hidden, dormant, or undocumented features in your app; your app's functionality should be clear to end users and App Review. Attempting to hide undocumented features in your app binary, such as through code obfuscation or other methods, is grounds for removal…"
- Apple's Oct 16 news describes 2.5.19 as covering "apps misrepresenting what they do during the App Review process and then changing after approval — for example, **adding features or functionality that weren't included in the version of the app that was submitted to App Review.**"
- **2.3.1(a)**: "All new features, functionality, and product changes must be described with specificity in the Notes for Review section… and accessible for review."
- Practical consequence: if the iOS shell loads live web content, the content tier served to iOS must be **fixed by the server per platform**, documented in Review Notes, and identical for the reviewer and for users. Turning on a different (more explicit) tier for iOS users later via the website or a remote flag is what 2.5.19 targets.

**What is realistically approvable vs not**

| Scenario | Likely outcome |
|---|---|
| iOS build with romance and companionship, suggestive but non-explicit text and voice, SFW images, rated **18+** (or 16+), Declared Age Range used, server-side iOS content tier, report and block, provider filters | **Approvable**, with the usual 4.2 and 4.3 risk if the shell is thin. Comparable to existing 17+/18+ companion apps. |
| Same, plus a "spicier" **non-explicit** tier for verified adults (age range ≥ 18 via Declared Age Range), still within "Non-explicit depictions… erotic or sensual dialog" | **Possible at 18+**, if the tier is documented in Review Notes, visible to the reviewer with a demo account, and stays non-explicit. Moderate risk: review judgment on "overtly sexual" (1.1.4) is subjective. |
| Explicit sexual roleplay text or voice in the iOS app, behind an in-app 18+ toggle | **Not approvable.** It falls under 1.1.4 and "Graphic Sexual Content" means Unrated, which cannot be published. |
| Explicit content hidden in-app and enabled only "via your website" (1.2 NSFW sentence) | **High risk, not recommended.** The exception covers "incidental" UGC from a web-based service. Here explicit AI output is a core feature, and an app "used primarily for pornographic content" can be removed without notice. |
| Nude or sexualized AI images of any kind in iOS, or editing uploaded real-person photos into intimate imagery | **Not approvable.** It falls under 1.1.4 and the NCII language in 1.2, and risks account termination. |
| Submitting a clean build, then flipping the server to serve explicit content to iOS | **Prohibited** (2.5.19, 2.3.1). Risks app removal and Developer Program termination. |

### 2.4 Payments (3.1)

- **3.1.1**: "If you want to unlock features or functionality within your app, (by way of example: subscriptions, in-game currencies, game levels, access to premium content, or unlocking a full version), you must use in-app purchase. Apps may not use their own mechanisms to unlock content or functionality, such as license keys…"
- **3.1.3(b) Multiplatform Services**: "Apps that operate across multiple platforms may allow users to access content, subscriptions, or features they have acquired in your app on other platforms or your web site… **provided those items are also available as in-app purchases within the app.**"
- **3.1.1(a)** and **3.1.3**: outside the US storefront, apps "may not include buttons, external links, or other calls to action that direct customers to purchasing mechanisms other than in-app purchase" unless they hold a StoreKit External Purchase Link Entitlement. On the **United States storefront this prohibition does not apply** ("These entitlements are not required for developers to include buttons, external links, or other calls to action in their United States storefront apps").
- **3.1.2(a)**: subscriptions "must provide ongoing value… the subscription period must last at least seven days and be available across all of the user's devices." **3.1.2(c)**: describe what the user gets before subscribing.
- **3.1.1**: credits "may not expire", and a restore mechanism is required.
- **2.1(b)**: IAPs must be "complete, up-to-date, visible to the reviewer and functional".
- Implication: **never sell an "adult unlock" via IAP.** Selling explicit content is impossible under 1.1.4, and selling a non-explicit 18+ tier ties the content tier to payment, which reviewers will scrutinize. Keep age gating separate from monetization.

### 2.5 Login (4.8) and accounts (5.1.1(v))

- **4.8**: "Apps that use a third-party or social login service (such as Facebook Login, Google Sign-In, Log in with X, Sign In with LinkedIn…) to set up or authenticate the user's primary account… must also offer as an equivalent option another login service" that limits data to name and email, allows a private email, and does not collect interactions for ads without consent. GitHub OAuth is a third-party login. Add **Sign in with Apple** (Clerk supports it), or ship iOS with email code only.
- **5.1.1(v)**: "If your app supports account creation, you must also offer account deletion within the app." It must actually delete server data and the Clerk user, not just sign out.
- **5.1.1(v)**: "If your app doesn't include significant account-based features, let people use it without a login." Anima is account-based (memory), so login is justified.

### 2.6 Privacy, including third-party AI (5.1)

- **5.1.2(i)**: "You must clearly disclose where personal data will be shared with third parties, **including with third-party AI**, and obtain explicit permission before doing so."
- **5.1.1(i)**: The privacy policy must "Identify what data… the app/service collects… and all uses of that data", and "Confirm that any third party with whom an app shares user data… will provide the same or equal protection", and explain retention and deletion.
- **5.1.1(ii)**: consent for collection, plus "an easily accessible and understandable way to withdraw consent"; purpose strings must be clear.
- **5.1.1(iii)**: data minimization, PHPicker.
- **5.1.2(vi)**: "Data gathered from… depth and/or facial mapping tools (such as ARKit, Camera APIs, or Photo APIs) may not be used for marketing, advertising or use-based data mining". This is relevant to face reference images for identity-locked photos.
- **5.1.5**: Location must be "directly relevant"; "notify and obtain consent". Applies to resonance `geo_lat`/`geo_lng`.
- **5.1.4**: if minors (13–17) can use the app, children's privacy laws apply, and chat and photos count as personal information from a minor.
- **1.6**: appropriate security for user information.
- **App Privacy "nutrition label"** in App Store Connect must match actual collection (2.3 "including privacy information… accurately reflect"): <https://developer.apple.com/app-store/app-privacy-details/>.
- Data that flows to AI providers today (from code): chat text and memory context to OpenAI, OpenRouter and Gemini, and possibly custom or Workers AI hosts. Voice audio and transcripts go to **xAI** (Grok Voice). TTS text goes to **ElevenLabs**. Prompts and **reference face images** go to **fal** and Gemini (photos). PDF text and embeddings go to the embedding provider (PDF pipeline). Each provider must be named in the policy and covered by an explicit in-app consent before first use (5.1.2(i)).

---

## 3. Web vs native split

The web app at anima-protocol.com, opened in Safari, is **not** subject to App Review. The guidelines say so themselves: "For everything else there is always the open Internet… we provide Safari for a great web experience too." The native shell **inherits App Store policy for everything it renders, including WKWebView content loaded from the live site, and everything it links to as a purchase call to action** (3.1.1(a) and 3.1.3 outside the US). 4.7 states "You are responsible for all such software offered in your app".

### 3.1 Responsibility table

| Concern | Must change or be enforced in the **native layer** (iOS app) | Can stay **web-only** (Safari / desktop) | **Shared server-side** (enforced in API, keyed on platform) |
|---|---|---|---|
| Explicit adult chat, voice and roleplay | Not reachable: hide the Adult Content Mode UI and intimacy settings. Do not deep-link to it. | Adult mode can remain, subject to web law (age verification laws, payment processor rules) | `client_platform=ios` ⇒ force `adultActive=false`. Ignore `metadata.adult_mode` from iOS. Cap content tier. Apply output moderation. |
| Explicit or nude images | Not reachable. No NSFW gallery views. | Policy decision for Dàvīn (see Open Questions) | Per-platform image policy: provider safety checker on every model including PuLID, post-generation classifier, store a `rating` per image, **never return images rated above the iOS tier to iOS sessions** (including history and gallery sync) |
| Age assurance | Declared Age Range (`requestAgeRange(ageGates: 13, 16, 18)`). Respect parental controls and `RESCIND_CONSENT`. Native age gate before any 16+/18+ tier. | DOB gate (revive `AgeVerificationGate`) or a third-party age-verification provider as required by local law | Store `age_band`, `age_source` (declared/guardian/payment/ID) and `verified_at`. **The server decides the tier**, not a client flag. |
| Content tier flag | Send platform and app version on every request. Don't trust local toggles. | Web settings UI | `content_tier` resolved server-side from (platform, age band, user setting, region). Document it in Review Notes. |
| Report and block | Native report button on messages, images and voice turns. Block or hide author for shared content. | Same features (good practice) | Report queue, moderation SLA, takedown, audit log, NCII hash-matching or blocklist |
| AI disclosure | First-run AI disclosure (reuse `AIDisclaimerModal` copy), persistent "AI" badge on companions. SB 243 break reminders for known minors. | Same | Store disclosure acceptance per account, not localStorage |
| Third-party AI consent | Native consent sheet naming providers before first chat, voice or photo. Withdraw in Settings. | Same consent (good practice) | `ai_consent` per provider. Block calls to a provider without consent. |
| Payments | StoreKit 2 IAP / subscriptions. No Stripe UI or links outside the US storefront unless entitled. | Stripe checkout | Entitlements service that unifies IAP receipts (App Store Server API) and Stripe, per 3.1.3(b) |
| Login | Sign in with Apple, plus email code. GitHub optional only alongside SIWA. | Any | Clerk with Apple provider enabled |
| Account deletion | In-app delete that calls a server endpoint | Same | `DELETE /api/account`: Clerk user, profile, chats, memories, photos, storage objects, embeddings, PDFs. Revoke the SIWA token. |
| Push | APNs with opt-in and neutral copy. No intimate content on the lock screen. | Web Push | Push service with an iOS channel and a content-safe template |
| Location (resonance) | Native permission prompt with a purpose string. Optional. Manual fallback. | Browser geolocation | Store coarse location only if needed |
| Voice | Native audio session, mic consent and indicator | WebRTC in browser | Ephemeral tokens (already). Same content tier on the voice agent. |
| Native value-add (4.2) | Voice, APNs, widgets, App Intents, haptics, offline cache, PHPicker, share sheet, optional AR | n/a | API support for offline sync |
| Remote code / bridge | Minimal plugin allow-list, no generic native bridge to remote JS (4.7.2). Bundle core UI where feasible. | n/a | n/a |
| Metadata | 4+-appropriate screenshots and icon (2.3.8). Accurate description. No "uncensored" or "NSFW" keywords. | Web marketing is separate, but 2.3.1(a) also covers misleading marketing "within or outside of the App Store" | n/a |

### 3.2 Recommended server mechanism

1. The native shell sends `X-Anima-Platform: ios` and `X-Anima-App-Version` and attests the platform. This is spoofable on its own, so pair it with **App Attest** (DeviceCheck) for iOS session tokens and/or a distinct Clerk session claim set at native sign-in.
2. `resolveContentPolicy({ platform, ageBand, userPrefs, region })` returns `{ tier: "general" | "mature_nonexplicit", imagePolicy, voicePolicy }`. For `ios`, `tier` never exceeds `mature_nonexplicit`, regardless of `adult_content_enabled` or `metadata.adult_mode`.
3. Model output moderation (text and transcripts) for the iOS tier. Image classification before storage and again before serving to iOS.
4. Audit logs of the tier decision per request, so moderation remediation can be shown to Apple if contacted (1.2 "provide a plan to improve your compliance").

---

## 4. Compliance checklist

### A. Native shell foundation
- [ ] Create the actual iOS project (Capacitor or native SwiftUI). None exists today.
- [ ] Build with Xcode 26.2+ and the iOS 26.2+ SDK (needed for the Declared Age Range features listed in Apple's age-assurance Q&A).
- [ ] Minimal native plugin allow-list. No generic JS→native bridge exposed to remote content (4.7.2).
- [ ] Universal links. App Intents route in-app, not to Safari (2.5.11).
- [ ] At least 4–5 genuine native features from §2.2 (voice session, APNs, widgets/Live Activity, App Intents, PHPicker/share, haptics, offline cache) (4.2).
- [ ] Works on IPv6-only networks (2.5.5). iPad layout acceptable (2.4.1).
- [ ] No placeholder content and no web "open in browser" dead-ends (2.1(a)).
- [ ] Do not ship separate SFW and 18+ bundle IDs (4.3(a)).

### B. Content tier and adult content
- [ ] Server forces non-explicit tier for `platform=ios`. Remove trust in `body.metadata.adult_mode` (chat.ts ~L2948) for all platforms, or at least iOS.
- [ ] Hide "18+ Adult Content Mode", intimacy settings, lewdity/sexuality sliders and NSFW intensity in iOS.
- [ ] Prompts for the iOS tier forbid explicit sexual description (1.1.4). Add output moderation on text and voice transcripts.
- [ ] Image pipeline: safety checker on **all** paths (add for PuLID), post-generation classifier, per-image rating, and filter history and gallery for iOS.
- [ ] No image editing of uploaded real-person photos into suggestive or intimate content. Likeness attestation on reference upload. NCII takedown path (1.2, Oct 2026 update).
- [ ] Exclude `anima-protocol.py` and any adult-only assets and prompts from the iOS bundle. Grep the built `.ipa` for adult strings before submission (2.5.19).
- [ ] Same content tier in the reviewer build and in production for iOS. Document it in Review Notes (2.3.1(a), 2.5.19).

### C. Age assurance
- [ ] Answer the full age rating questionnaire, including In-App Controls, Capabilities (UGC, Messaging/Chat, Social Media if any) and AI or chatbot frequency (2.3.6; Jul 2025 and Jul 2026 news).
- [ ] Target rating decided (likely **18+**, or 16+ if the iOS tier is mild). Consider setting the higher rating to match the minimum-age policy.
- [ ] Integrate the Declared Age Range API with age gates (e.g. 13/16/18). Handle `declinedSharing`. Check `requiredRegulatoryFeatures` and `isEligibleForAgeFeatures`. Handle `RESCIND_CONSENT`.
- [ ] Server stores age band and source. Mature tiers require an age band ≥ 18 (or ≥ 16 for 16+ themes).
- [ ] Revive or replace the unused `AgeVerificationGate`. Persist the result server-side, not in localStorage.
- [ ] If any users under 18 are allowed: [Context] SB 243 minor protections (AI disclosure, 3-hour break reminders, no sexual visual material). Children's privacy laws (5.1.4).

### D. Moderation and UGC (1.2, 4.7.1)
- [ ] Report button on each message, image, voice turn, character and node. Backend queue. Documented response time.
- [ ] Block or hide abusive users for any cross-user content (global resonance nodes, shared characters). If none is shared, document that in Review Notes.
- [ ] Published contact info in-app (Settings → Support) and a Support URL in App Store Connect (1.2, 1.5).
- [ ] Community guidelines and terms linked in-app (`public/community-guidelines.html` exists; review its content).
- [ ] Crisis protocol (exists). Publish protocol details on the website ([Context] SB 243 §22602(b)(2)).

### E. AI transparency
- [ ] First-run AI disclosure stored per account. Persistent AI labeling of companions and generated images (HIG Generative AI; no explicit App Review labeling rule).
- [ ] [Context] EU AI Act Art. 50: visible label on synthetic lifelike images and machine-readable marking (consider C2PA) if offered in the EU.
- [ ] Don't present therapy mode as medical treatment. Add a "check with a professional" reminder (1.4.1).

### F. Privacy (5.1)
- [ ] Privacy policy names every AI processor: OpenAI, OpenRouter (and its upstream models), Google Gemini, fal, xAI, ElevenLabs, any embedding host, Supabase, Cloudflare, Clerk, Stripe. It must state data types, retention, training use and deletion (5.1.1(i), 5.1.2(i)).
- [ ] Explicit in-app consent before sharing data with third-party AI, with a withdraw option (5.1.2(i), 5.1.1(ii)).
- [ ] App Privacy label in App Store Connect matches reality (chat content, audio, photos, identifiers, coarse location if used).
- [ ] Purpose strings: microphone, photo library (add-only for save), camera if used, location if used. No tracking without ATT (5.1.2(i)).
- [ ] Face reference images are not used for marketing or analytics (5.1.2(vi)). Define retention.
- [ ] Mic indicator and consent during voice (2.5.14).

### G. Accounts and login
- [ ] Sign in with Apple via Clerk if GitHub OAuth (or Google etc.) is offered in iOS (4.8).
- [ ] In-app account deletion that deletes the Clerk user and all server data and storage, and revokes Apple tokens (5.1.1(v)).
- [ ] Demo account for App Review with backend live (2.1(a)), configured with the exact iOS content tier.

### H. Payments
- [ ] If anything is sold in iOS, use StoreKit IAP or subscriptions with restore (3.1.1, 3.1.2).
- [ ] Web purchases honored in iOS only if the same items are available as IAP (3.1.3(b)).
- [ ] Outside the US storefront: no Stripe links or CTAs in the app without the External Purchase Link entitlement (3.1.1(a)).
- [ ] No paid "adult unlock".

### I. Metadata and submission
- [ ] Screenshots, icon and preview are 4+-appropriate (2.3.8). No suggestive companion art.
- [ ] Description and keywords avoid "NSFW", "uncensored", "18+ chat" and similar (2.3.7, 1.1.4 risk).
- [ ] Review Notes: explain the content tier, age assurance, moderation, providers, and how the iOS tier differs from the web (2.3.1(a)).
- [ ] Delete or rewrite `artifacts/anima-protocol/public/app-store-requirements.md` (inaccurate, publicly served).
- [ ] [Context] Check the Texas SB 2420 and Utah status at submission time with counsel. Regional age categories come through the Declared Age Range API.

---

## 5. Open Questions for Dàvīn (resolve before submission)

1. **Will the iOS build ever show explicit sexual content (text, voice or images)?** The recommended answer is "no". The iOS app would carry a non-explicit tier only, and explicit mode would remain web-only. Please confirm. If the answer is "yes", the App Store is not a viable channel.
2. **What is the target age rating: 18+, or 16+ with a milder tier?** Will under-18 users be allowed in the iOS app at all? If yes, from what age (13+?), with what parental-consent flow?
3. **Should the web version keep explicit adult mode?** If so, which age-verification method satisfies local laws for the web (self-attestation is likely insufficient in several jurisdictions)?
4. **What is the monetization path on iOS?** Free, IAP subscription, or consumable credits (photo generations, voice minutes)? Is Stripe web-purchase access to be honored in iOS (requires matching IAP)? Which storefronts (US-only links vs entitlement elsewhere)?
5. **Which login providers ship on iOS?** Email code only, or keep GitHub, plus Sign in with Apple?
6. **Which AI providers will receive iOS user data?** (OpenAI, OpenRouter and which upstream models, Gemini, fal, xAI Grok Voice, ElevenLabs, embedding host, self-hosted models.) Do any providers train on or retain data? Do DPAs exist?
7. **Photo generator scope on iOS:** allow user-uploaded **real-person** reference photos at all, or only fictional or companion identities? If real photos are allowed, must the uploader attest that it is their own face? What is the NCII takedown SLA?
8. **Is any content shared between users** (global resonance nodes, shared characters, encounters with other users' companions, public galleries)? This decides the scope of block-user and the "Social Media" questionnaire answer.
9. **Which regions and storefronts at launch?** This affects EU AI Act labeling, US state age laws, Korea and Brazil ratings, and external purchase links.
10. **Shell technology:** Capacitor wrapping the live site, Capacitor with bundled assets, or native SwiftUI screens for voice and home? Bundled assets reduce the 2.5.2/2.5.19 "changes after review" risk.
11. **Is therapy mode in the iOS app?** If so, how is it positioned (wellness, not treatment) for the Medical/Wellness questionnaire and 1.4.1?
12. **Organization vs individual developer account**, the legal entity name shown on the store, and the support contact (1.5, 5.6.2).
13. **Who handles moderation reports and Apple contacts** (named owner, response time)?
14. **Should root `anima-protocol.py` and other adult-only artifacts remain in the main repo**, given reviewers and the public can see it?

---

## Sources (primary unless marked)

- App Review Guidelines (Oct 16, 2026): <https://developer.apple.com/app-store/review/guidelines/>
- Apple news, "Updated App Review Guidelines are now available" (Oct 16, 2026): <https://developer.apple.com/news/?id=92th7e5i>
- Apple news, "Strengthening App Review Guidelines against nonconsensual intimate imagery and bait-and-switch apps" (Oct 16, 2026): <https://developer.apple.com/news/?id=vvzx6cul>
- Age ratings values and definitions: <https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/>
- Set an app age rating: <https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/>
- Apple news, "Updated age ratings in App Store Connect" (Jul 24, 2025): <https://developer.apple.com/news/?id=ks775ehf>
- Apple news, "Age rating questionnaire now includes social media questions" (Jul 9, 2026): <https://developer.apple.com/news/?id=tlur8uvi>
- Age assurance developer Q&A: <https://developer.apple.com/support/age-assurance>
- Declared Age Range docs: <https://developer.apple.com/documentation/declaredagerange/requesting-people-share-their-age-range-with-your-app>
- WWDC25 "Deliver age-appropriate experiences in your app": <https://developer.apple.com/videos/play/wwdc2025/299/>
- HIG, Generative AI: <https://developer.apple.com/design/human-interface-guidelines/generative-ai/>
- App Privacy details: <https://developer.apple.com/app-store/app-privacy-details/>
- [Context] California SB 243, Bus. & Prof. Code ch. 22.6: <https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?chapter=22.6&division=8.&lawCode=BPC>
- [Context] EU AI Act Art. 50 FAQ: <https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act>
- [Context, secondary] SCOTUSblog on Texas SB 2420 (Jul 6, 2026): <https://www.scotusblog.com/2026/07/supreme-court-allows-texas-to-enforce-law-requiring-age-verification-and-parental-consent-on-app/>
