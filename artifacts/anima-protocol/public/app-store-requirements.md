# App Store Requirements - Anima Protocol

## ✅ Completed Fixes

### 1. Privacy & Legal
- [x] Privacy Policy (`/privacy-policy`)
- [x] Terms of Service (`/terms-of-service`)
- [x] COPPA Compliance (13+ with parental controls for 13-17)
- [x] Adult Content Toggle (18+ restricted)
- [x] Explicit Consent for Data Usage

### 2. App Metadata
- [x] App Title: "Anima Protocol - AI Companion"
- [x] Proper Description
- [x] Keywords & Categories
- [x] Manifest.json with icons
- [x] Safe Area Inset Support (iOS notch/home bar)

### 3. Code Quality
- [x] External URL handling via Capacitor (web/iOS/Android compatible)
- [x] Safe area padding for mobile
- [x] No hardcoded debug credentials
- [x] Proper error handling

### 4. Content Guidelines
- [x] No sexualization of minors
- [x] Clear content warnings
- [x] User controls for explicit content
- [x] Age-appropriate UI

## 📋 Submission Checklist

Before submitting to App Store:

1. **App Icon**: Create a proper 1024x1024 PNG icon
   - Replace URL in manifest.json and index.html

2. **Screenshots**: Add 2-3 app screenshots to marketing materials
   - Minimum 640x920 (iPhone 6s)
   - Maximum 1080x1920 (iPhone XS Max)

3. **Test Account**: Create a dummy account for reviewers
   - No IAP required but can add later
   - Test all major flows

4. **Content Rating Questionnaire**:
   - Mature Themes: Yes (relationships, conflict)
   - Violence: Fantasy only
   - Sexual Content: Yes (can be disabled)
   - Alcohol/Tobacco: No
   - Gambling: No

5. **Build & Sign**:
   - Xcode: Archive → Distribute App
   - Or use Capacitor: `npx cap open ios`
   - Sign with valid Apple Developer cert

6. **Deployment Target**: iOS 13+, Android API 21+
   - Verify in Capacitor config

## ⚠️ Common Rejection Reasons (Now Fixed)

- ❌ Missing privacy policy → ✅ Added
- ❌ No terms of service → ✅ Added
- ❌ External URL handling → ✅ Fixed with Capacitor
- ❌ COPPA violations → ✅ Compliant
- ❌ Misleading metadata → ✅ Accurate description
- ❌ Safe area ignored → ✅ Responsive to notches

## 🚀 Next Steps

1. Build iOS/Android via Capacitor
2. Fill in App Store Connect form
3. Upload build and submit
4. Monitor reviewer feedback
