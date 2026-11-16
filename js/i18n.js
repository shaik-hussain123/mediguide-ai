/**
 * @file UI translations: English, Hindi, Tamil, Bengali (SRS §12.3 multi-language).
 * Only interface text is translated. Medicine facts stay in English (see README): translations of
 * medical content need clinical review. MediChat answers in the chosen language.
 * Translations were drafted by the developer's tooling and need native-speaker review before release.
 */
import * as store from './utils/storage.js';
import { KEYS } from './config.js';

export const LANGS = {
  en: { native: 'English', speech: 'en-IN', aiName: 'English' },
  hi: { native: 'हिन्दी', speech: 'hi-IN', aiName: 'Hindi' },
  ta: { native: 'தமிழ்', speech: 'ta-IN', aiName: 'Tamil' },
  bn: { native: 'বাংলা', speech: 'bn-IN', aiName: 'Bengali' },
};
const ORDER = ['en', 'hi', 'ta', 'bn'];

// key: [English, Hindi, Tamil, Bengali]
const D = {
  elderly: ['Elderly Mode', 'बुज़ुर्ग मोड', 'முதியோர் முறை', 'বয়স্ক মোড'],
  about: ['About', 'परिचय', 'பற்றி', 'পরিচিতি'],
  settings: ['Settings', 'सेटिंग्स', 'அமைப்புகள்', 'সেটিংস'],
  admin: ['Admin', 'एडमिन', 'நிர்வாகி', 'অ্যাডমিন'],
  login: ['Login', 'लॉगिन', 'உள்நுழை', 'লগইন'],
  voiceMode: ['Voice Mode', 'वॉइस मोड', 'குரல் முறை', 'ভয়েস মোড'],
  install: ['Install App', 'ऐप इंस्टॉल करें', 'செயலியை நிறுவு', 'অ্যাপ ইনস্টল করুন'],
  tabMedicine: ['Medicine', 'दवा', 'மருந்து', 'ওষুধ'],
  tabScanner: ['Image Scanner', 'इमेज स्कैनर', 'படம் ஸ்கேனர்', 'ইমেজ স্ক্যানার'],
  tabRx: ['Prescription', 'पर्चा', 'மருந்துச்சீட்டு', 'প্রেসক্রিপশন'],
  tabCare: ['Doctor', 'डॉक्टर', 'மருத்துவர்', 'ডাক্তার'],
  tabReminders: ['Reminders', 'रिमाइंडर', 'நினைவூட்டல்கள்', 'রিমাইন্ডার'],
  bannerLead: ['Medical Disclaimer:', 'चिकित्सा अस्वीकरण:', 'மருத்துவ மறுப்பு:', 'চিকিৎসা দাবিত্যাগ:'],
  bannerBody: ["MediGuide AI provides information only. It does not replace a doctor's prescription. No prescription replacement. Only CDSCO-approved medicines are listed.",
    'MediGuide AI केवल जानकारी देता है। यह डॉक्टर के पर्चे का विकल्प नहीं है। केवल CDSCO-अनुमोदित दवाएँ सूचीबद्ध हैं।',
    'MediGuide AI தகவல் மட்டுமே வழங்குகிறது. இது மருத்துவரின் மருந்துச்சீட்டுக்கு மாற்று அல்ல. CDSCO அங்கீகரித்த மருந்துகள் மட்டுமே பட்டியலிடப்பட்டுள்ளன.',
    'MediGuide AI শুধুমাত্র তথ্য দেয়। এটি ডাক্তারের প্রেসক্রিপশনের বিকল্প নয়। শুধুমাত্র CDSCO-অনুমোদিত ওষুধ তালিকাভুক্ত।'],
  medInfo: ['Medicine Information', 'दवा की जानकारी', 'மருந்து தகவல்', 'ওষুধের তথ্য'],
  searchPlaceholder: ['Search by name, company, category or symptom…', 'नाम, कंपनी, श्रेणी या लक्षण से खोजें…', 'பெயர், நிறுவனம், வகை அல்லது அறிகுறி மூலம் தேடுங்கள்…', 'নাম, কোম্পানি, বিভাগ বা উপসর্গ দিয়ে খুঁজুন…'],
  searchBtn: ['Search', 'खोजें', 'தேடு', 'খুঁজুন'],
  filter: ['Filter:', 'फ़िल्टर:', 'வடிகட்டு:', 'ফিল্টার:'],
  allCategories: ['All Categories', 'सभी श्रेणियाँ', 'அனைத்து வகைகள்', 'সব বিভাগ'],
  manufacturers: ['Manufacturers', 'निर्माता कंपनियाँ', 'உற்பத்தியாளர்கள்', 'প্রস্তুতকারক'],
  buyOnline: ['Buy Online (Verified Pharmacies)', 'ऑनलाइन खरीदें (सत्यापित फ़ार्मेसी)', 'ஆன்லைனில் வாங்க (சரிபார்க்கப்பட்ட மருந்தகங்கள்)', 'অনলাইনে কিনুন (যাচাইকৃত ফার্মেসি)'],
  chatPlaceholder: ['Ask about dosage, side effects, interactions…', 'खुराक, दुष्प्रभाव, इंटरैक्शन के बारे में पूछें…', 'அளவு, பக்க விளைவுகள், இடைவினைகள் பற்றி கேளுங்கள்…', 'ডোজ, পার্শ্বপ্রতিক্রিয়া, মিথস্ক্রিয়া সম্পর্কে জিজ্ঞাসা করুন…'],
  qSide: ['Side Effects', 'दुष्प्रभाव', 'பக்க விளைவுகள்', 'পার্শ্বপ্রতিক্রিয়া'],
  qDose: ['Dosage', 'खुराक', 'அளவு', 'ডোজ'],
  qInter: ['Interactions', 'इंटरैक्शन', 'இடைவினைகள்', 'মিথস্ক্রিয়া'],
  qPreg: ['Pregnancy', 'गर्भावस्था', 'கர்ப்பம்', 'গর্ভাবস্থা'],
  qElder: ['Elderly Dose', 'बुज़ुर्गों की खुराक', 'முதியோர் அளவு', 'বয়স্কদের ডোজ'],
  welcomeTitle: ['Hello! I am MediChat.', 'नमस्ते! मैं MediChat हूँ।', 'வணக்கம்! நான் MediChat.', 'নমস্কার! আমি MediChat।'],
  welcome1: ['Ask about a medicine: uses, dosage, side effects, interactions.', 'किसी दवा के बारे में पूछें: उपयोग, खुराक, दुष्प्रभाव, इंटरैक्शन।', 'மருந்து பற்றி கேளுங்கள்: பயன்கள், அளவு, பக்க விளைவுகள், இடைவினைகள்.', 'ওষুধ সম্পর্কে জিজ্ঞাসা করুন: ব্যবহার, ডোজ, পার্শ্বপ্রতিক্রিয়া, মিথস্ক্রিয়া।'],
  welcome2: ['Attach a photo of a tablet strip or box (or a voice or video clip) and I will describe it.', 'टेबलेट की पट्टी या डिब्बे की फ़ोटो (या आवाज़/वीडियो) भेजें, मैं उसका वर्णन करूँगा।', 'மாத்திரை அட்டை அல்லது பெட்டியின் புகைப்படத்தை (அல்லது குரல்/வீடியோ) இணையுங்கள், நான் விவரிக்கிறேன்.', 'ট্যাবলেটের স্ট্রিপ বা বাক্সের ছবি (বা ভয়েস/ভিডিও) যোগ করুন, আমি বর্ণনা দেব।'],
  welcome3: ['I give information only. I cannot prescribe or change your dose.', 'मैं केवल जानकारी देता हूँ। मैं दवा नहीं लिख सकता और खुराक नहीं बदल सकता।', 'நான் தகவல் மட்டுமே தருகிறேன். மருந்து பரிந்துரைக்கவோ அளவை மாற்றவோ முடியாது.', 'আমি শুধু তথ্য দিই। আমি ওষুধ লিখে দিতে বা ডোজ বদলাতে পারি না।'],
  disclaimer: ['This is informational only. Consult a doctor.', 'यह केवल जानकारी के लिए है। कृपया डॉक्टर से सलाह लें।', 'இது தகவலுக்காக மட்டுமே. மருத்துவரை அணுகவும்.', 'এটি শুধুমাত্র তথ্যের জন্য। অনুগ্রহ করে ডাক্তারের পরামর্শ নিন।'],
  aiReady: ['AI ready', 'AI तैयार है', 'AI தயார்', 'AI প্রস্তুত'],
  aiNotSet: ['AI not set up', 'AI सेट नहीं है', 'AI அமைக்கப்படவில்லை', 'AI সেট করা নেই'],
  listen: ['Listen', 'सुनें', 'கேளுங்கள்', 'শুনুন'],
  cdsco: ['CDSCO Approved', 'CDSCO अनुमोदित', 'CDSCO அங்கீகரிக்கப்பட்டது', 'CDSCO অনুমোদিত'],
  rxBadge: ['Prescription (Rx)', 'पर्चे से (Rx)', 'மருந்துச்சீட்டு (Rx)', 'প্রেসক্রিপশন (Rx)'],
  otc: ['OTC', 'बिना पर्चे', 'OTC', 'OTC'],
  manufacturer: ['Manufacturer', 'निर्माता', 'உற்பத்தியாளர்', 'প্রস্তুতকারক'],
  strength: ['Strength', 'ताकत', 'வீரியம்', 'শক্তি'],
  category: ['Category', 'श्रेणी', 'வகை', 'বিভাগ'],
  ageGroup: ['Age group', 'आयु वर्ग', 'வயது பிரிவு', 'বয়স গোষ্ঠী'],
  commonlyUsed: ['Commonly used for', 'आमतौर पर इसके लिए उपयोग', 'பொதுவாக இதற்குப் பயன்படுகிறது', 'সাধারণত যে কারণে ব্যবহৃত হয়'],
  howToTake: ['How to take it', 'इसे कैसे लें', 'எப்படி எடுத்துக்கொள்வது', 'কীভাবে নেবেন'],
  perDose: ['per dose', 'प्रति खुराक', 'ஒரு அளவுக்கு', 'প্রতি ডোজে'],
  child: ['Child', 'बच्चा', 'குழந்தை', 'শিশু'],
  adult: ['Adult', 'वयस्क', 'பெரியவர்', 'প্রাপ্তবয়স্ক'],
  senior: ['Senior 60+', 'वरिष्ठ 60+', 'முதியோர் 60+', 'বয়স্ক ৬০+'],
  morning: ['Morning', 'सुबह', 'காலை', 'সকাল'],
  afternoon: ['Afternoon', 'दोपहर', 'மதியம்', 'দুপুর'],
  evening: ['Evening', 'शाम', 'மாலை', 'সন্ধ্যা'],
  night: ['Night', 'रात', 'இரவு', 'রাত'],
  important: ['Important', 'ज़रूरी', 'முக்கியம்', 'গুরুত্বপূর্ণ'],
  alternatives: ['Similar alternatives', 'मिलते-जुलते विकल्प', 'ஒத்த மாற்றுகள்', 'অনুরূপ বিকল্প'],
  pros: ['Pros', 'फ़ायदे', 'நன்மைகள்', 'সুবিধা'],
  cons: ['Cons', 'नुकसान', 'குறைகள்', 'অসুবিধা'],
  askAbout: ['Ask MediChat about', 'MediChat से पूछें:', 'MediChat-இடம் கேளுங்கள்:', 'MediChat-কে জিজ্ঞাসা করুন:'],
  tellMeAbout: ['Tell me about', 'मुझे बताइए:', 'எனக்குச் சொல்லுங்கள்:', 'আমাকে বলুন:'],
  foundN: ['{n} medicines found', '{n} दवाएँ मिलीं', '{n} மருந்துகள் கிடைத்தன', '{n}টি ওষুধ পাওয়া গেছে'],
  noResults: ['No results', 'कोई परिणाम नहीं', 'முடிவுகள் இல்லை', 'কোনো ফলাফল নেই'],
  tierRoutine: ['Everyday medicine', 'रोज़मर्रा की दवा', 'அன்றாட மருந்து', 'দৈনন্দিন ওষুধ'],
  tierCare: ['Use with care', 'सावधानी से उपयोग करें', 'கவனத்துடன் பயன்படுத்தவும்', 'সতর্কতার সাথে ব্যবহার করুন'],
  tierRx: ['Prescription only', 'केवल पर्चे पर', 'மருந்துச்சீட்டு மட்டும்', 'শুধু প্রেসক্রিপশনে'],
  remindMe: ['Remind me', 'मुझे याद दिलाएँ', 'எனக்கு நினைவூட்டு', 'আমাকে মনে করিয়ে দিন'],
  careTitle: ['Talk to a doctor', 'डॉक्टर से बात करें', 'மருத்துவரிடம் பேசுங்கள்', 'ডাক্তারের সাথে কথা বলুন'],
  careNote: ['Sample doctors for demonstration only. In an emergency call 112.', 'केवल प्रदर्शन के लिए नमूना डॉक्टर। आपातकाल में 112 पर कॉल करें।', 'விளக்கத்திற்கான மாதிரி மருத்துவர்கள் மட்டும். அவசரத்தில் 112-ஐ அழைக்கவும்.', 'শুধু প্রদর্শনের জন্য নমুনা ডাক্তার। জরুরি অবস্থায় ১১২ নম্বরে কল করুন।'],
  book: ['Book', 'बुक करें', 'முன்பதிவு', 'বুক করুন'],
  myAppts: ['My appointments', 'मेरी अपॉइंटमेंट', 'என் சந்திப்புகள்', 'আমার অ্যাপয়েন্টমেন্ট'],
  videoCall: ['Video call', 'वीडियो कॉल', 'வீடியோ அழைப்பு', 'ভিডিও কল'],
  clinic: ['Clinic visit', 'क्लिनिक में', 'கிளினிக் வருகை', 'ক্লিনিক ভিজিট'],
  date: ['Date', 'तारीख़', 'தேதி', 'তারিখ'],
  reason: ['Reason (optional)', 'कारण (वैकल्पिक)', 'காரணம் (விருப்பம்)', 'কারণ (ঐচ্ছিক)'],
  confirm: ['Confirm booking', 'बुकिंग पक्की करें', 'முன்பதிவை உறுதி செய்', 'বুকিং নিশ্চিত করুন'],
  cancel: ['Cancel', 'रद्द करें', 'ரத்து செய்', 'বাতিল'],
  join: ['Join video call', 'वीडियो कॉल में जुड़ें', 'வீடியோ அழைப்பில் சேர்', 'ভিডিও কলে যোগ দিন'],
  pickSlot: ['Pick a time', 'समय चुनें', 'நேரத்தைத் தேர்ந்தெடுக்கவும்', 'সময় বেছে নিন'],
  loginToBook: ['Please log in to book an appointment.', 'अपॉइंटमेंट बुक करने के लिए लॉगिन करें।', 'முன்பதிவு செய்ய உள்நுழையவும்.', 'অ্যাপয়েন্টমেন্ট বুক করতে লগইন করুন।'],
  needServer: ['Doctor booking needs the MediGuide server (npm start).', 'डॉक्टर बुकिंग के लिए MediGuide सर्वर (npm start) चाहिए।', 'மருத்துவர் முன்பதிவுக்கு MediGuide சர்வர் (npm start) தேவை.', 'ডাক্তার বুকিংয়ের জন্য MediGuide সার্ভার (npm start) লাগবে।'],
  remTitle: ['Medicine reminders', 'दवा रिमाइंडर', 'மருந்து நினைவூட்டல்கள்', 'ওষুধের রিমাইন্ডার'],
  addReminder: ['Add reminder', 'रिमाइंडर जोड़ें', 'நினைவூட்டல் சேர்', 'রিমাইন্ডার যোগ করুন'],
  medicineName: ['Medicine name', 'दवा का नाम', 'மருந்தின் பெயர்', 'ওষুধের নাম'],
  doseLbl: ['Dose', 'खुराक', 'அளவு', 'ডোজ'],
  timesLbl: ['Times', 'समय', 'நேரங்கள்', 'সময়'],
  addTime: ['Add time', 'समय जोड़ें', 'நேரம் சேர்', 'সময় যোগ করুন'],
  daysLbl: ['For how many days', 'कितने दिनों के लिए', 'எத்தனை நாட்களுக்கு', 'কত দিনের জন্য'],
  saveReminder: ['Save reminder', 'रिमाइंडर सहेजें', 'நினைவூட்டலை சேமி', 'রিমাইন্ডার সংরক্ষণ'],
  enableNotif: ['Allow notifications', 'सूचनाएँ चालू करें', 'அறிவிப்புகளை அனுமதி', 'নোটিফিকেশন চালু করুন'],
  remNote: ['Reminders ring while MediGuide is open in your browser.', 'रिमाइंडर तब बजते हैं जब MediGuide आपके ब्राउज़र में खुला हो।', 'MediGuide உங்கள் உலாவியில் திறந்திருக்கும்போது நினைவூட்டல்கள் ஒலிக்கும்.', 'MediGuide ব্রাউজারে খোলা থাকলে রিমাইন্ডার বাজবে।'],
  takeNow: ['Time to take', 'दवा लेने का समय:', 'மருந்து எடுக்கும் நேரம்:', 'ওষুধ খাওয়ার সময়:'],
  pause: ['Pause', 'रोकें', 'இடைநிறுத்து', 'থামান'],
  resume: ['Resume', 'फिर शुरू करें', 'தொடர்', 'চালু করুন'],
  remove: ['Delete', 'हटाएँ', 'நீக்கு', 'মুছুন'],
  abhaTitle: ['ABHA (Health Account)', 'ABHA (स्वास्थ्य खाता)', 'ABHA (சுகாதார கணக்கு)', 'ABHA (স্বাস্থ্য অ্যাকাউন্ট)'],
  language: ['Language', 'भाषा', 'மொழி', 'ভাষা'],
};

let lang = 'en';
const subs = new Set();
export const currentLang = () => lang;
export const onLangChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };

export function t(key, vars = {}) {
  const e = D[key];
  const s = e ? (e[ORDER.indexOf(lang)] || e[0]) : key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

export function applyI18n(root = document) {
  document.documentElement.lang = lang;
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', t(el.dataset.i18nTitle)); });
}

export function setLang(code, { persist = true } = {}) {
  if (!LANGS[code]) return;
  lang = code;
  if (persist) store.set(KEYS.lang, code);
  const sel = document.getElementById('langSelect');
  if (sel) sel.value = code;
  applyI18n();
  subs.forEach((fn) => fn(code));
}

export function initI18n() {
  const sel = document.getElementById('langSelect');
  if (sel) {
    sel.innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${v.native}</option>`).join('');
    sel.addEventListener('change', () => setLang(sel.value));
  }
  const saved = store.get(KEYS.lang, null);
  const guess = (navigator.language || 'en').slice(0, 2);
  setLang(LANGS[saved] ? saved : LANGS[guess] ? guess : 'en', { persist: false });
}

export const missingKeys = () => Object.entries(D).filter(([, v]) => v.length !== 4 || v.some((x) => !x)).map(([k]) => k);
