# TODO - Allow sessions to be saved to the user profile

- [ ] Inspect existing store/profile API and client sync helpers
- [ ] Add backend endpoints to read/write `saved_sessions` inside `user_profiles.data`
- [ ] Update Chat page to persist “ongoing conversation” by recording last opened session(s)
- [ ] Update UserProfile page to display saved/ongoing sessions and allow opening them
- [ ] Add navigation from saved session to `/chat/:sessionId`
- [ ] Test manually: open chats, refresh, sign out/in, verify saved sessions persist across devices

