/** 翻译方向（固定英译中） */
export const SOURCE_LANG = 'en';
export const TARGET_LANG = 'zh';

/** 段落过滤 */
export const MIN_TEXT_LENGTH = 3;
/** 不超过该词数且没有小写字母的文字视为徽章/缩写（NEW、FREE、US ONLY、TTL），不翻译 */
export const MAX_BADGE_WORDS = 3;
/** 中日韩字符数 / (中日韩字符数 + 英文单词数) 超过该值视为已是中文 */
export const MAX_CJK_RATIO = 0.3;
/** 无 lang 属性时，拉丁字母占比达到该值视为英文页面 */
export const ENGLISH_PAGE_MIN_LATIN_RATIO = 0.5;
export const PAGE_SAMPLE_CHARS = 2000;
/** 等待页面 load 事件的上限（ms）：脆弱页面推迟翻译、悬浮球推迟挂载时使用 */
export const PAGE_LOAD_MAX_WAIT_MS = 5000;
/** 页面加载完后等待浏览器空闲的上限（ms） */
export const PAGE_IDLE_TIMEOUT_MS = 2000;
/** 判断 Next.js 时最多检查的内联脚本数 */
export const NEXT_SCRIPT_SCAN_LIMIT = 50;

/** 内容脚本调度 */
export const VIEWPORT_ROOT_MARGIN = '100% 0px';
export const CONTENT_FLUSH_MS = 50;
export const MUTATION_DEBOUNCE_MS = 300;

/** 后台大模型批处理 */
export const BATCH_MAX_ITEMS = 20;
export const BATCH_MAX_CHARS = 2500;
export const BATCH_WAIT_MS = 150;
export const MAX_CONCURRENT_REQUESTS = 3;
/** 大模型错误响应正文在错误信息中保留的最大字符数 */
export const LLM_ERROR_DETAIL_MAX = 200;
/** 单次大模型请求（含流式读取全过程）的超时时间，超时后释放并发名额，已完成的段落不受影响 */
export const LLM_TIMEOUT_MS = 30_000;

/** 通信、存储与 DOM 标记 */
export const PORT_NAME = 'translate';
export const LAST_ERROR_KEY = 'lastError';
export const TR_TAG = 'it-tr';
export const CACHE_DB_NAME = 'immersive-translator';
export const CACHE_STORE_NAME = 'translations';

/** 页面侧边悬浮球 */
export const BALL_TAG = 'it-ball';
/** 悬浮球直径（px） */
export const BALL_SIZE = 36;
/** 悬浮球默认垂直位置（占视口高度比例） */
export const BALL_DEFAULT_TOP = 0.6;
/** 指针移动超过该距离（px）视为拖动而不是点击 */
export const BALL_DRAG_THRESHOLD = 4;
