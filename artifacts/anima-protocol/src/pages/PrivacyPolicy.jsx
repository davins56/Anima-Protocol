// @ts-check
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { usePageMeta, ROUTE_META } from "@/lib/usePageMeta";

const sections = [
  {
    num: 1,
    title: "Introduction",
    content: (
      <>
        <p>Echoes of Eden Inc. ("we," "us," "our") operates the Anima Protocol platform and takes your privacy seriously. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our Service.</p>
        <p className="mt-2">By creating an account or using the Service, you consent to the practices described in this Policy. If you do not agree, please do not use the Service.</p>
        <p className="mt-2"><strong className="text-primary">Effective Date:</strong> May 2026</p>
      </>
    ),
  },
  {
    num: 2,
    title: "Information We Collect",
    content: (
      <>
        <p><strong className="text-primary">Information you provide directly:</strong></p>
        <ul className="list-disc list-inside space-y-1 ml-4 mt-1 mb-3">
          <li>Account registration details (email address, display name)</li>
          <li>Chat messages, story content, and character descriptions you create</li>
          <li>Documents and files you upload for AI context (novels, essays, journals)</li>
          <li>Payment information processed through Stripe (we do not store card numbers)</li>
          <li>Support requests and communications with us</li>
          <li>Settings and preferences you configure</li>
        </ul>
        <p><strong className="text-primary">Information collected automatically:</strong></p>
        <ul className="list-disc list-inside space-y-1 ml-4 mt-1 mb-3">
          <li>Device information (browser type, operating system, device identifiers)</li>
          <li>Log data (IP address, access times, pages viewed, referring URLs)</li>
          <li>Usage data (features used, session duration, interaction patterns)</li>
          <li>Cookies and similar tracking technologies</li>
        </ul>
        <p><strong className="text-primary">Information from third parties:</strong></p>
        <ul className="list-disc list-inside space-y-1 ml-4 mt-1">
          <li>Authentication data from login providers you use</li>
          <li>Payment status and subscription data from Stripe</li>
        </ul>
      </>
    ),
  },
  {
    num: 3,
    title: "How We Use Your Information",
    content: (
      <>
        <p>We use your information to:</p>
        <ul className="list-disc list-inside space-y-1.5 ml-4 mt-2">
          <li>Provide, maintain, and operate the Service</li>
          <li>Personalize AI character interactions and generate narrative responses</li>
          <li>Process payments and manage subscriptions</li>
          <li>Send transactional emails (account activity, billing, legal notices)</li>
          <li>Send optional promotional communications (you may opt out at any time)</li>
          <li>Analyze usage patterns to improve features and fix bugs</li>
          <li>Detect, prevent, and investigate fraud, abuse, and security incidents</li>
          <li>Comply with legal obligations and enforce our Terms of Service</li>
          <li>Respond to your support requests</li>
        </ul>
      </>
    ),
  },
  {
    num: 4,
    title: "AI Training and Conversation Data",
    content: (
      <>
        <p>By default, your conversation data and chat history are <strong className="text-primary">not</strong> used to train external AI models. Your conversations are processed solely to generate responses within your active session and to maintain the persistent memory features of your Anima Protocol experience.</p>
        <p className="mt-2">Aggregate, anonymized usage data (such as feature interaction statistics, not conversation content) may be used to improve our Service. We do not sell your conversation content to third parties.</p>
        <p className="mt-2">If you upload documents for background context (novels, journals, etc.), those are processed by our AI systems to generate personalized responses and stored securely in your account. You can delete these at any time through Settings → Background Context.</p>
      </>
    ),
  },
  {
    num: 5,
    title: "Sharing and Disclosure",
    content: (
      <>
        <p>We do not sell your personal information. We may share your information with:</p>
        <ul className="list-disc list-inside space-y-1.5 ml-4 mt-2">
          <li><strong className="text-primary">Service Providers:</strong> Third-party vendors who assist in operating the Service (cloud hosting, payment processing via Stripe, AI model providers, voice synthesis via ElevenLabs) under confidentiality obligations</li>
          <li><strong className="text-primary">Legal Requirements:</strong> When required by law, subpoena, or court order, or to protect the rights, property, or safety of Echoes of Eden Inc., our users, or the public</li>
          <li><strong className="text-primary">Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets, where your data may be transferred to the successor entity</li>
          <li><strong className="text-primary">With Your Consent:</strong> In any other circumstances with your explicit prior consent</li>
        </ul>
      </>
    ),
  },
  {
    num: 6,
    title: "Cookies and Tracking Technologies",
    content: (
      <>
        <p>We use cookies and similar technologies (local storage, session tokens) to:</p>
        <ul className="list-disc list-inside space-y-1 ml-4 mt-2 mb-3">
          <li>Keep you logged in and maintain your session</li>
          <li>Remember your preferences (theme, language, settings)</li>
          <li>Analyze how the Service is used to improve features</li>
          <li>Prevent fraud and ensure security</li>
        </ul>
        <p>Essential cookies required for the Service to function cannot be disabled. You may control non-essential cookies through your browser settings, but doing so may affect Service functionality.</p>
      </>
    ),
  },
  {
    num: 7,
    title: "Data Security",
    content: (
      <>
        <p>We implement industry-standard security measures to protect your personal information, including:</p>
        <ul className="list-disc list-inside space-y-1 ml-4 mt-2 mb-3">
          <li>Encryption of data in transit (TLS/HTTPS) and at rest</li>
          <li>Access controls limiting who can access your data within our organization</li>
          <li>Regular security reviews and monitoring</li>
          <li>Secure payment processing through Stripe (we never store full card numbers)</li>
        </ul>
        <p>No method of transmission over the internet is completely secure. While we strive to protect your data, we cannot guarantee absolute security. In the event of a data breach affecting your rights and freedoms, we will notify affected users as required by applicable law.</p>
      </>
    ),
  },
  {
    num: 8,
    title: "Data Retention",
    content: (
      <>
        <p>We retain your personal data for as long as your account is active and as necessary to provide the Service. Specific retention periods:</p>
        <ul className="list-disc list-inside space-y-1.5 ml-4 mt-2">
          <li><strong className="text-primary">Account data:</strong> Retained until account deletion plus 90 days for backup purging</li>
          <li><strong className="text-primary">Conversation history:</strong> Retained until you delete sessions or your account</li>
          <li><strong className="text-primary">Payment records:</strong> Retained for 7 years as required by financial regulations</li>
          <li><strong className="text-primary">Log data:</strong> Retained for up to 12 months for security and debugging</li>
          <li><strong className="text-primary">Support communications:</strong> Retained for 3 years</li>
        </ul>
        <p className="mt-2">After account deletion, your personal data is permanently removed from active systems within 30 days and from backups within 90 days, except where retention is required by law.</p>
      </>
    ),
  },
  {
    num: 9,
    title: "Your Rights",
    content: (
      <>
        <p>Depending on your jurisdiction, you may have the following rights regarding your personal data:</p>
        <ul className="list-disc list-inside space-y-1.5 ml-4 mt-2">
          <li><strong className="text-primary">Access:</strong> Request a copy of the personal data we hold about you</li>
          <li><strong className="text-primary">Correction:</strong> Request correction of inaccurate or incomplete data</li>
          <li><strong className="text-primary">Deletion:</strong> Request deletion of your personal data (available via Settings → Data & Privacy)</li>
          <li><strong className="text-primary">Portability:</strong> Request your data in a structured, machine-readable format</li>
          <li><strong className="text-primary">Restriction:</strong> Request restriction of processing in certain circumstances</li>
          <li><strong className="text-primary">Objection:</strong> Object to processing based on legitimate interests</li>
          <li><strong className="text-primary">Opt-out of marketing:</strong> Unsubscribe from promotional emails at any time</li>
        </ul>
        <p className="mt-2">To exercise these rights, contact us at <span className="text-primary">privacy@animaprotocol.com</span>. We will respond within 30 days. Identity verification may be required.</p>
      </>
    ),
  },
  {
    num: 10,
    title: "Children's Privacy",
    content: (
      <p>The Service is not directed to children under 13 years of age. We do not knowingly collect personal information from children under 13. If you believe we have inadvertently collected information from a child under 13, please contact us at <span className="text-primary">privacy@animaprotocol.com</span> immediately and we will take steps to delete such information. Users between 13 and 17 may use the Service only with verifiable parental consent.</p>
    ),
  },
  {
    num: 11,
    title: "International Data Transfers",
    content: (
      <p>Echoes of Eden Inc. is based in the United States. If you access the Service from outside the United States, your information may be transferred to, stored, and processed in the United States where our servers are located and our central database is operated. By using the Service, you consent to the transfer of your information to the United States. We implement appropriate safeguards for international transfers as required by applicable law, including standard contractual clauses where applicable.</p>
    ),
  },
  {
    num: 12,
    title: "California Privacy Rights (CCPA)",
    content: (
      <>
        <p>If you are a California resident, you have additional rights under the California Consumer Privacy Act (CCPA):</p>
        <ul className="list-disc list-inside space-y-1.5 ml-4 mt-2">
          <li>The right to know what personal information we collect, use, disclose, and sell</li>
          <li>The right to delete personal information we have collected from you</li>
          <li>The right to opt-out of the sale of personal information (we do not sell your data)</li>
          <li>The right to non-discrimination for exercising your privacy rights</li>
        </ul>
        <p className="mt-2">To submit a CCPA request, contact us at <span className="text-primary">privacy@animaprotocol.com</span> with the subject "CCPA Request."</p>
      </>
    ),
  },
  {
    num: 13,
    title: "Third-Party Services",
    content: (
      <>
        <p>The Service integrates with the following third-party providers, each with their own privacy practices:</p>
        <ul className="list-disc list-inside space-y-1.5 ml-4 mt-2">
          <li><strong className="text-primary">Stripe:</strong> Payment processing — <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" className="underline">stripe.com/privacy</a></li>
          <li><strong className="text-primary">ElevenLabs:</strong> Voice synthesis — <a href="https://elevenlabs.io/privacy" target="_blank" rel="noopener noreferrer" className="underline">elevenlabs.io/privacy</a></li>
          <li><strong className="text-primary">Base44:</strong> Platform infrastructure</li>
        </ul>
        <p className="mt-2">We are not responsible for the privacy practices of third-party services. We recommend reviewing their privacy policies independently.</p>
      </>
    ),
  },
  {
    num: 14,
    title: "Changes to This Policy",
    content: (
      <p>We may update this Privacy Policy from time to time. When we make material changes, we will notify you via email or prominent in-app notice at least 14 days before the changes take effect. The updated Policy will be posted here with a revised effective date. Your continued use of the Service after the effective date constitutes your acceptance of the revised Policy.</p>
    ),
  },
  {
    num: 15,
    title: "Contact Us",
    content: (
      <>
        <p>For privacy-related questions, requests, or concerns:</p>
        <div className="mt-3 p-4 border border-primary/20 bg-primary/5 space-y-1">
          <p><span className="text-primary">Privacy Requests:</span> privacy@animaprotocol.com</p>
          <p><span className="text-primary">General Support:</span> support@animaprotocol.com</p>
          <p><span className="text-primary">Company:</span> Echoes of Eden Inc.</p>
          <p><span className="text-primary">Platform:</span> Anima Protocol</p>
        </div>
      </>
    ),
  },
];

export default function PrivacyPolicy() {
  usePageMeta(ROUTE_META["/privacy-policy"]);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background pb-24">
      {/* Header */}
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <Link to="/settings" className="text-primary/40 hover:text-primary transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">Privacy Policy</h1>
            <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase mt-0.5">Anima Protocol · Echoes of Eden Inc. · Effective May 2026</p>
          </div>
        </div>
      </div>

      {/* Table of Contents */}
      <div className="max-w-4xl mx-auto px-6 pt-8 pb-4">
        <div className="border border-primary/15 bg-black/40 p-5">
          <p className="font-mono text-[9px] text-primary/40 tracking-[0.3em] uppercase mb-3">Table of Contents</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
            {sections.map(s => (
              <a
                key={s.num}
                href={`#pp-section-${s.num}`}
                className="font-mono text-[10px] text-primary/50 hover:text-primary transition-colors"
              >
                {s.num}. {s.title}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="max-w-4xl mx-auto px-6 py-4 space-y-8">
        {sections.map(s => (
          <section key={s.num} id={`pp-section-${s.num}`} className="space-y-3 border-b border-primary/10 pb-8 last:border-b-0">
            <h2 className="font-mono text-primary tracking-widest uppercase text-sm">
              {s.num}. {s.title}
            </h2>
            <div className="font-mono text-sm text-primary/70 leading-relaxed">
              {s.content}
            </div>
          </section>
        ))}

        {/* Footer Links */}
        <div className="pt-4 border-t border-primary/20 flex flex-wrap gap-x-6 gap-y-2 text-[10px] font-mono text-primary/40">
          <Link to="/terms" className="hover:text-primary transition-colors">Terms of Service</Link>
          <Link to="/privacy-policy" className="hover:text-primary transition-colors">Privacy Policy</Link>
          <Link to="/disclaimer" className="hover:text-primary transition-colors">Disclaimer</Link>
          <a href="mailto:support@animaprotocol.com" className="hover:text-primary transition-colors">Contact</a>
          <a href="mailto:dmca@animaprotocol.com" className="hover:text-primary transition-colors">DMCA Notice</a>
        </div>
      </div>
    </div>
  );
}