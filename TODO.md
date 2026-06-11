 dont want the creat# TODO

## Implement: change my profile photo on the welcome screen

- [ ] Inspect welcome screen code and identify what “profile photo” means in this UI (companion avatar vs user avatar)
- [ ] Implement avatar upload/change UI on `artifacts/anima-protocol/src/components/chat/WelcomeScreen.jsx`
- [ ] Reuse existing upload capability (`base44.integrations.Core.UploadFile`) or existing portrait uploader patterns
- [ ] Persist the changed image to the correct entity field (for A: Anima avatar_url)
- [ ] Ensure the welcome screen updates immediately and doesn’t break existing hover/edit behavior
- [ ] Run lint/tests/build for the anima-protocol workspace and confirm no runtime errors

