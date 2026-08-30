// @ts-check
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { usePageMeta, ROUTE_META } from "@/lib/usePageMeta";

const sections = [
  {
    num: 1,
    title: "Eligibility",
    content: (
      <>
        <p>You must be at least 13 years of age to create an account and use Anima Protocol. By accessing or using the Service, you represent and warrant that you meet this minimum age requirement. If you are under 18 years of age, you may only use the Service with the consent and supervision of a parent or legal guardian who agrees to be bound by these Terms.</p>
        <p className="mt-2">Features explicitly marked as 18+ require that you be at least 18 years old. By enabling any adult content feature, you confirm you meet the applicable age requirement. Anima Protocol reserves the right to terminate accounts found to be in violation of age restrictions.</p>
      </>
    ),
  },
  {
    num: 2,
    title: "Description of Service",
    content: (
      <>
        <p>Anima Protocol ("we," "us," "our") provides an AI-powered interactive storytelling and companion platform ("Service") operated by Echoes of Eden Inc. The Service includes persistent narrative experiences, AI character companions, memory systems, world-building tools, and related features accessible via web and mobile applications.</p>
        <p className="mt-2">We reserve the right to modify, suspend, or discontinue any aspect of the Service at any time with or without notice. We shall not be liable to you or any third party for any modification, suspension, or discontinuation of the Service.</p>
      </>
    ),
  },
  {
    num: 3,
    title: "User Accounts",
    content: (
      <>
        <p>To access certain features, you must create an account. You agree to provide accurate, current, and complete information during registration and to update such information as necessary. You are responsible for safeguarding your account credentials and for all activity that occurs under your account.</p>
        <p className="mt-2">You may not share your account with others, create multiple accounts to circumvent restrictions, or transfer your account to any other person. You must notify us immediately at support@animaprotocol.com if you suspect unauthorized use of your account.</p>
      </>
    ),
  },
  {
    num: 4,
    title: "User Content",
    content: (
      <>
        <p>The Service allows you to create, upload, and share content including chat messages, character descriptions, story content, and related materials ("User Content"). You retain ownership of your User Content.</p>
        <p className="mt-2">By submitting User Content, you grant Anima Protocol a worldwide, non-exclusive, royalty-free, sublicensable license to use, reproduce, adapt, publish, translate, and distribute your User Content solely for the purpose of operating and improving the Service. This license terminates when you delete your User Content or account, except where your content has been shared with others who have not deleted it.</p>
        <p className="mt-2">You represent that you own or have the necessary rights to the User Content you submit, and that it does not violate any third-party rights or applicable law.</p>
      </>
    ),
  },
  {
    num: 5,
    title: "Prohibited Conduct",
    content: (
      <>
        <p>You agree not to use the Service to:</p>
        <ul className="list-disc list-inside space-y-1.5 ml-4 mt-2">
          <li>Violate any applicable local, state, national, or international law or regulation</li>
          <li>Generate or distribute content that sexualizes minors under any circumstances</li>
          <li>Harass, threaten, stalk, or otherwise harm any individual</li>
          <li>Impersonate any person or entity or misrepresent your affiliation with any person or entity</li>
          <li>Upload or transmit viruses, malware, or any other malicious code</li>
          <li>Attempt to gain unauthorized access to any part of the Service or its infrastructure</li>
          <li>Scrape, crawl, or otherwise extract data from the Service without express written permission</li>
          <li>Use the Service for any commercial purpose without our prior written consent</li>
          <li>Circumvent or bypass any content filters, age gates, or access controls</li>
          <li>Reverse engineer, decompile, or disassemble any part of the Service</li>
          <li>Use the Service to train competing AI models or services</li>
          <li>Engage in any conduct that restricts or inhibits others' use or enjoyment of the Service</li>
        </ul>
        <p className="mt-2">Violation of these prohibitions may result in immediate account termination and, where applicable, referral to law enforcement authorities.</p>
      </>
    ),
  },
  {
    num: 6,
    title: "Intellectual Property",
    content: (
      <>
        <p>All content, features, functionality, design, software, code, and underlying technology of the Service — excluding User Content — are owned by Echoes of Eden Inc. or its licensors and are protected by United States and international copyright, trademark, patent, trade secret, and other intellectual property laws.</p>
        <p className="mt-2">You are granted a limited, non-exclusive, non-transferable, revocable license to access and use the Service for your personal, non-commercial purposes. This license does not include any right to sublicense, sell, resell, transfer, or commercially exploit the Service or its content.</p>
        <p className="mt-2">The Anima Protocol name, logos, and related marks are trademarks of Echoes of Eden Inc. You may not use these marks without our prior written permission.</p>
      </>
    ),
  },
  {
    num: 7,
    title: "AI-Generated Content Disclaimer",
    content: (
      <>
        <p>Anima Protocol uses artificial intelligence to generate narrative content, character dialogue, and creative materials. <strong className="text-primary">AI-generated content is provided for entertainment and creative purposes only.</strong></p>
        <ul className="list-disc list-inside space-y-1.5 ml-4 mt-2">
          <li>AI characters are fictional constructs and do not represent real persons, relationships, or entities</li>
          <li>AI-generated content may be inaccurate, incomplete, or inconsistent — do not rely on it for professional, medical, legal, financial, or safety advice</li>
          <li>Emotional connections formed with AI characters are experiences within a fictional framework</li>
          <li>We do not guarantee that AI responses will be appropriate for all audiences at all times</li>
          <li>AI outputs may occasionally contain unexpected, offensive, or disturbing content despite our content filters</li>
        </ul>
        <p className="mt-2">If you encounter content that appears harmful or violates these Terms, please report it via the in-app reporting tools or at support@animaprotocol.com.</p>
      </>
    ),
  },
  {
    num: 8,
    title: "Termination",
    content: (
      <>
        <p>We reserve the right to suspend or terminate your account and access to the Service, with or without notice, at our sole discretion, for any reason including but not limited to: violation of these Terms, conduct we believe is harmful to other users or the Service, or inactivity for an extended period.</p>
        <p className="mt-2">You may terminate your account at any time by using the account deletion feature in Settings. Upon termination, your license to use the Service ceases immediately. Sections that by their nature should survive termination — including Intellectual Property, Disclaimer of Warranties, Limitation of Liability, Indemnification, and Governing Law — shall survive.</p>
      </>
    ),
  },
  {
    num: 9,
    title: "Disclaimer of Warranties",
    content: (
      <p>THE SERVICE IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AND ANY WARRANTIES ARISING OUT OF COURSE OF DEALING OR USAGE OF TRADE. ECHOES OF EDEN INC. DOES NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, SECURE, OR FREE OF VIRUSES OR OTHER HARMFUL COMPONENTS. YOUR USE OF THE SERVICE IS AT YOUR SOLE RISK.</p>
    ),
  },
  {
    num: 10,
    title: "Limitation of Liability",
    content: (
      <>
        <p>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL ECHOES OF EDEN INC., ITS OFFICERS, DIRECTORS, EMPLOYEES, AFFILIATES, AGENTS, OR LICENSORS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, PUNITIVE, OR EXEMPLARY DAMAGES — INCLUDING LOSS OF PROFITS, DATA, GOODWILL, OR OTHER INTANGIBLE LOSSES — ARISING OUT OF OR RELATING TO YOUR USE OF OR INABILITY TO USE THE SERVICE.</p>
        <p className="mt-2">IN NO EVENT WILL OUR AGGREGATE LIABILITY TO YOU FOR ALL CLAIMS ARISING OUT OF OR RELATING TO THE SERVICE EXCEED THE GREATER OF (A) ONE HUNDRED U.S. DOLLARS ($100.00) OR (B) THE AMOUNTS PAID BY YOU TO US IN THE TWELVE (12) MONTHS IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM.</p>
      </>
    ),
  },
  {
    num: 11,
    title: "Indemnification",
    content: (
      <p>You agree to indemnify, defend, and hold harmless Echoes of Eden Inc. and its officers, directors, employees, agents, and licensors from and against any claims, liabilities, damages, judgments, awards, losses, costs, expenses, or fees (including reasonable attorneys' fees) arising out of or relating to: (a) your violation of these Terms; (b) your User Content; (c) your use of the Service; or (d) your violation of any rights of another person or entity.</p>
    ),
  },
  {
    num: 12,
    title: "Governing Law",
    content: (
      <p>These Terms and your use of the Service shall be governed by and construed in accordance with the laws of the State of Delaware, United States, without regard to its conflict of law provisions. You agree that any legal action or proceeding between you and Echoes of Eden Inc. shall be brought exclusively in a federal or state court of competent jurisdiction located in Delaware, and you hereby consent to the personal jurisdiction and venue therein, subject to the Arbitration Agreement in Section 19.</p>
    ),
  },
  {
    num: 13,
    title: "Changes to Terms",
    content: (
      <>
        <p>We reserve the right to modify these Terms at any time. When we make material changes, we will provide notice via email, in-app notification, or by posting the revised Terms on this page with an updated effective date.</p>
        <p className="mt-2">Your continued use of the Service after the effective date of any changes constitutes your acceptance of the revised Terms. If you do not agree to the revised Terms, you must stop using the Service and may delete your account.</p>
      </>
    ),
  },
  {
    num: 14,
    title: "Contact",
    content: (
      <>
        <p>For questions, concerns, or legal notices regarding these Terms, please contact us:</p>
        <div className="mt-3 p-4 border border-primary/20 bg-primary/5 space-y-1">
          <p><span className="text-primary">Company:</span> Echoes of Eden Inc.</p>
          <p><span className="text-primary">Platform:</span> Anima Protocol</p>
          <p><span className="text-primary">Email:</span> support@animaprotocol.com</p>
          <p><span className="text-primary">Legal:</span> legal@animaprotocol.com</p>
        </div>
      </>
    ),
  },
  {
    num: 15,
    title: "Subscriptions and Payments",
    content: (
      <>
        <p>Certain features of the Service require a paid subscription ("Subscription"). By purchasing a Subscription, you agree to pay the applicable fees and authorize us to charge the payment method you provide on a recurring basis at the then-current subscription price.</p>
        <ul className="list-disc list-inside space-y-1.5 ml-4 mt-2">
          <li><strong className="text-primary">Billing:</strong> Subscriptions renew automatically unless cancelled before the renewal date</li>
          <li><strong className="text-primary">Cancellation:</strong> You may cancel at any time through your account settings; cancellation takes effect at the end of the current billing period</li>
          <li><strong className="text-primary">Refunds:</strong> Except as required by law, all fees are non-refundable</li>
          <li><strong className="text-primary">Price Changes:</strong> We will provide at least 30 days notice before changing subscription prices</li>
          <li><strong className="text-primary">Free Trials:</strong> Free trials automatically convert to paid subscriptions unless cancelled before the trial period ends</li>
        </ul>
        <p className="mt-2">We use Stripe to process payments. By making a purchase, you also agree to Stripe's terms of service. We do not store full payment card information on our servers.</p>
      </>
    ),
  },
  {
    num: 16,
    title: "Mature Content Policy",
    content: (
      <>
        <p>Anima Protocol offers optional mature content features ("Adult Mode") for users who are 18 years of age or older. By enabling Adult Mode, you represent and warrant that you are at least 18 years old and consent to receiving explicit, adult-oriented AI-generated content.</p>
        <ul className="list-disc list-inside space-y-1.5 ml-4 mt-2">
          <li>Content depicting minors in any sexual or explicit context is strictly prohibited and will result in immediate account termination and potential law enforcement referral, regardless of Adult Mode settings</li>
          <li>All explicit content is AI-generated fiction and does not involve real persons</li>
          <li>We reserve the right to restrict or remove mature content at our sole discretion</li>
          <li>Adult Mode is not available in jurisdictions where such content is prohibited by law</li>
        </ul>
      </>
    ),
  },
  {
    num: 17,
    title: "Community Guidelines",
    content: (
      <>
        <p>To maintain a safe and creative environment, all users must adhere to the following community guidelines:</p>
        <ul className="list-disc list-inside space-y-1.5 ml-4 mt-2">
          <li>Treat other users and their creative works with respect</li>
          <li>Do not use shared features to harass, bully, or target individuals</li>
          <li>Do not share content intended to incite violence, hatred, or discrimination based on race, ethnicity, religion, gender, sexual orientation, disability, or national origin</li>
          <li>Do not impersonate real living persons in harmful ways</li>
          <li>Do not share content that glorifies self-harm or suicide</li>
          <li>Report content or behavior that violates these guidelines using the in-app tools</li>
        </ul>
        <p className="mt-2">Violations of community guidelines may result in content removal, feature restrictions, temporary suspension, or permanent account termination depending on severity.</p>
      </>
    ),
  },
  {
    num: 18,
    title: "Copyright Complaints and DMCA Policy",
    content: (
      <>
        <p>Echoes of Eden Inc. respects intellectual property rights and expects users to do the same. In accordance with the Digital Millennium Copyright Act (DMCA), we will respond to notices of alleged copyright infringement.</p>
        <p className="mt-2">To submit a DMCA takedown notice, provide the following to our designated agent:</p>
        <ul className="list-disc list-inside space-y-1.5 ml-4 mt-2">
          <li>A physical or electronic signature of the copyright owner or authorized agent</li>
          <li>Identification of the copyrighted work claimed to be infringed</li>
          <li>Identification of the material that is claimed to be infringing, with sufficient information to locate it</li>
          <li>Your contact information (name, address, telephone, email)</li>
          <li>A statement of good faith belief that the use is not authorized</li>
          <li>A statement, under penalty of perjury, that the information in the notice is accurate</li>
        </ul>
        <p className="mt-2">Send DMCA notices to: <span className="text-primary">dmca@animaprotocol.com</span></p>
        <p className="mt-2">Users who repeatedly infringe copyrights may have their accounts terminated.</p>
      </>
    ),
  },
  {
    num: 19,
    title: "Arbitration Agreement",
    content: (
      <>
        <p><strong className="text-primary">PLEASE READ THIS SECTION CAREFULLY — IT AFFECTS YOUR LEGAL RIGHTS.</strong></p>
        <p className="mt-2">Except for disputes that qualify for small claims court, you and Echoes of Eden Inc. agree to resolve any dispute, claim, or controversy arising out of or relating to these Terms or the Service through binding individual arbitration rather than in court.</p>
        <ul className="list-disc list-inside space-y-1.5 ml-4 mt-2">
          <li><strong className="text-primary">Class Action Waiver:</strong> You waive any right to participate in a class action lawsuit or class-wide arbitration</li>
          <li><strong className="text-primary">Rules:</strong> Arbitration shall be conducted under the American Arbitration Association (AAA) Consumer Arbitration Rules</li>
          <li><strong className="text-primary">Location:</strong> Arbitration will be conducted remotely or in Delaware at your option</li>
          <li><strong className="text-primary">Opt-Out:</strong> You may opt out of this arbitration agreement within 30 days of first accepting these Terms by emailing legal@animaprotocol.com with the subject "Arbitration Opt-Out"</li>
        </ul>
      </>
    ),
  },
  {
    num: 20,
    title: "Electronic Communications",
    content: (
      <p>By creating an account or using the Service, you consent to receiving electronic communications from Anima Protocol. These may include emails about your account, service updates, promotional offers, and legal notices. Electronic notices from us shall satisfy any legal requirement that communications be in writing. You may opt out of marketing communications at any time via your account settings or the unsubscribe link in any email. Transactional and legal notices cannot be opted out of while your account is active.</p>
    ),
  },
  {
    num: 21,
    title: "Data Retention and Account Deletion",
    content: (
      <>
        <p>We retain your account data, conversation history, and associated content for as long as your account is active or as needed to provide the Service. You may request deletion of your account and personal data at any time through Settings → Data & Privacy → Delete Account.</p>
        <ul className="list-disc list-inside space-y-1.5 ml-4 mt-2">
          <li>Account deletion requests are processed within 30 days</li>
          <li>Some data may be retained for up to 90 days in backups before permanent deletion</li>
          <li>We may retain certain data as required by law, fraud prevention, or legitimate business purposes</li>
          <li>Anonymized or aggregated data derived from your use may be retained indefinitely</li>
        </ul>
      </>
    ),
  },
  {
    num: 22,
    title: "Third-Party Services",
    content: (
      <>
        <p>The Service integrates with or relies upon third-party services including but not limited to AI model providers, voice synthesis platforms (ElevenLabs), payment processors (Stripe), and cloud infrastructure providers. Your use of such services is subject to their respective terms and privacy policies.</p>
        <p className="mt-2">We are not responsible for the content, accuracy, privacy practices, or availability of third-party services. Links to third-party sites do not constitute an endorsement by Anima Protocol.</p>
      </>
    ),
  },
  {
    num: 23,
    title: "Export Control and Sanctions",
    content: (
      <p>You represent that you are not located in, or a resident of, any country subject to a U.S. government embargo or designated by the U.S. government as a "terrorist supporting" country, and that you are not listed on any U.S. government list of prohibited or restricted parties. You agree to comply with all applicable export control and sanctions laws in connection with your use of the Service.</p>
    ),
  },
  {
    num: 24,
    title: "Entire Agreement",
    content: (
      <p>These Terms of Service, together with our Privacy Policy and any additional terms applicable to specific features, constitute the entire agreement between you and Echoes of Eden Inc. regarding your use of the Service, and supersede all prior and contemporaneous agreements, proposals, or representations, written or oral, concerning the Service. If any provision of these Terms is found to be unenforceable, the remaining provisions will continue in full force and effect. Our failure to enforce any right or provision in these Terms will not constitute a waiver of such right or provision.</p>
    ),
  },
];

export default function TermsOfUse() {
  usePageMeta(ROUTE_META["/terms"]);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background pb-24">
      {/* Header */}
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <Link to="/settings" className="text-primary/40 hover:text-primary transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">Terms of Service</h1>
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
                href={`#section-${s.num}`}
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
          <section key={s.num} id={`section-${s.num}`} className="space-y-3 border-b border-primary/10 pb-8 last:border-b-0">
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