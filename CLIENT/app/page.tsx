'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Activity,
    Shield,
    User,
    Users,
    Clock,
    Send,
    Volume2,
    MessageSquare,
    Trash2,
    Download,
    RefreshCw,
    Search,
    X,
    Zap,
    KeyRound,
    Gem,
    Bot,
    Play,
    Square,
    ListChecks,
    RotateCcw,
    Loader2,
    AlertTriangle,
    CheckCircle2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

const SOCKET_URL = process.env.SOCKET_URL ?? 'wss://api-socket.parroto.app/socket.io/?EIO=4&transport=websocket';
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:8080';
const TOKEN_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

type LogEvent = {
    id: string;
    direction: 'in' | 'out' | 'auth' | 'error';
    type: string;
    data: any;
    time: string;
};

type BattleToast = {
    id: string;
    type: 'success' | 'error' | 'info';
    title: string;
    message: string;
};

type CollectedVocab = {
    cardId: string;
    word: string;
    time: string;
};

type ServerCard = {
    id: number | null;
    card_id: string;
    word: string;
    source: string;
};

type LLMGuessPayload = {
    wordLength: number;
    wordMask: string;
    letterCount: number;
    explanation_en: string;
    exampleMasked_en: string;
    type: string;
};

type LLMGuessResult = {
    answer?: string;
    confidence?: number | string;
    reason?: string;
    raw?: string;
};

type LLMGuessApiResponse = {
    guess?: LLMGuessResult;
};

type CheckInApiResponse = {
    status: string;
    message: string;
    data?: {
        current_streak: number;
        max_streak: number;
        freeze_count: number;
        freeze_used: boolean;
        daily_reward_diamonds: number;
        milestone_reached: string | null;
        already_counted_today: boolean;
    };
};

type CheckInCache = {
    date: string;
    checkedAt: string;
    message: string;
    reward?: number;
    currentStreak?: number;
};

type VocabBattleActivityResponse = {
    status: string;
    message: string;
    data?: {
        _id: string;
        userId: string;
        elo: number;
        totalDiamondsLost: number;
        totalDiamondsWon: number;
        totalDraws: number;
        totalGames: number;
        totalLosses: number;
        totalRoundsWon: number;
        totalWins: number;
        lastPlayedAt?: string;
        createdAt?: string;
        updatedAt?: string;
    };
};

type BattleActivityStats = {
    elo: number;
    totalGames: number;
    totalWins: number;
    totalLosses: number;
    totalDraws: number;
    totalRoundsWon: number;
    totalDiamondsWon: number;
    totalDiamondsLost: number;
    updatedAt?: string;
};

type Opponent = {
    userId: string;
    displayName?: string;
    photoURL?: string;
    isPremium?: boolean;
    diamonds?: number;
};

type OpponentMessage = {
    id: string;
    eventName: string;
    userId?: string;
    displayName?: string;
    text: string;
    time: string;
    raw: any;
};

type UserInfo = {
    userId: string;
    email: string;
};

type BotQueueInputBot = {
    botId: string;
    firebaseToken: string;
    userId: string;
    email: string;
};

type BotQueueServerBot = {
    botId?: string;
    bot_id?: string;
    firebaseToken?: string;
    firebase_token?: string;
    userId?: string;
    user_id?: string;
    email?: string;
    status?: string;
    lastEvent?: string;
    last_event?: string;
    message?: string;
    retryCount?: number;
    retry_count?: number;
    startedAt?: string;
    started_at?: string;
    updatedAt?: string;
    updated_at?: string;
};

type BotQueueStatus = {
    running?: boolean;
    activeSearching?: string;
    active_searching?: string;
    bots: BotQueueServerBot[];
    message?: string;
    totalBots?: number;
    updatedAt?: string;
};

const DEFAULT_USER_INFO: UserInfo = {
    userId: 'Không có ID',
    email: 'Không có Email',
};

const decodeJwtPayload = (token: string): any | null => {
    const jwt = token.trim();
    const payloadPart = jwt.split('.')[1];

    if (!payloadPart) return null;

    try {
        const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
        const paddedBase64 = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
        const decoded = atob(paddedBase64);

        const json = decodeURIComponent(
            decoded
                .split('')
                .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
                .join(''),
        );

        return JSON.parse(json);
    } catch {
        return null;
    }
};

const getUserInfoFromFirebaseToken = (token: string): UserInfo => {
    const payload = decodeJwtPayload(token);

    return {
        userId: payload?.user_id || payload?.uid || payload?.sub || 'Không có ID',
        email: payload?.email || payload?.firebase?.identities?.email?.[0] || 'Không có Email',
    };
};

const getAvoidUserIdList = (value: string) =>
    value
        .split(/[\s,;]+/)
        .map((id) => id.trim().toLowerCase())
        .filter(Boolean);

const parseBotQueueInput = (value: string): BotQueueInputBot[] => {
    return value
        .split('\n')
        .map((rawLine, index) => {
            const line = rawLine.trim();
            if (!line) return null;

            const parts = line.split('|').map((part) => part.trim());
            const hasCustomBotId = parts.length >= 2;
            const botId = hasCustomBotId && parts[0] ? parts[0] : `bot_${index + 1}`;
            const firebaseToken = hasCustomBotId ? parts.slice(1).join('|').trim() : line;

            if (!firebaseToken) return null;

            const info = getUserInfoFromFirebaseToken(firebaseToken);
            return {
                botId,
                firebaseToken,
                userId: info.userId,
                email: info.email,
            };
        })
        .filter((item): item is BotQueueInputBot => Boolean(item));
};

const normalizeBotQueueResponse = (payload: any): BotQueueStatus => {
    const data = payload?.data ?? payload ?? {};
    const bots = Array.isArray(data?.bots) ? data.bots : Array.isArray(data) ? data : [];

    return {
        ...data,
        bots,
    };
};

const getBotQueueStatusLabel = (status?: string) => {
    switch ((status || '').toLowerCase()) {
        case 'waiting':
            return 'Đang chờ';
        case 'connecting':
            return 'Đang kết nối';
        case 'searching':
            return 'Đang tìm trận';
        case 'in_battle':
            return 'Đã vào trận';
        case 'finished':
            return 'Hoàn tất';
        case 'error':
            return 'Lỗi';
        case 'stopped':
            return 'Đã dừng';
        case 'draft':
            return 'Chưa gửi server';
        default:
            return status || '--';
    }
};

const getBotQueueStatusClass = (status?: string) => {
    switch ((status || '').toLowerCase()) {
        case 'waiting':
            return 'border-slate-200 bg-slate-100 text-slate-600';
        case 'connecting':
            return 'border-amber-200 bg-amber-50 text-amber-700';
        case 'searching':
            return 'border-sky-200 bg-sky-50 text-sky-700';
        case 'in_battle':
            return 'border-emerald-200 bg-emerald-50 text-emerald-700';
        case 'finished':
            return 'border-violet-200 bg-violet-50 text-violet-700';
        case 'error':
            return 'border-rose-200 bg-rose-50 text-rose-700';
        case 'stopped':
            return 'border-slate-200 bg-white text-slate-500';
        case 'draft':
            return 'border-dashed border-slate-200 bg-white text-slate-400';
        default:
            return 'border-slate-200 bg-white text-slate-600';
    }
};

export default function ParotoMonitor() {
    const [socketStatus, setSocketStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
    const [firebaseToken, setFirebaseToken] = useState('');
    const [autoConnect, setAutoConnect] = useState(false);

    const [apiKey, setApiKey] = useState('');
    const [refreshToken, setRefreshToken] = useState('');
    const [autoRefreshToken, setAutoRefreshToken] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [autoTimedRefreshToken, setAutoTimedRefreshToken] = useState(false);
    const [scheduledRefreshStatus, setScheduledRefreshStatus] = useState('Auto refresh 30p: OFF');
    const [autoCheckIn, setAutoCheckIn] = useState(false);
    const [isCheckingIn, setIsCheckingIn] = useState(false);
    const [checkInToday, setCheckInToday] = useState(false);
    const [checkInStatusText, setCheckInStatusText] = useState('Chưa check-in hôm nay');
    const [avoidUserIds, setAvoidUserIds] = useState('');
    const [battleRoomId, setBattleRoomId] = useState('');
    const [battleRoomPassword, setBattleRoomPassword] = useState('');
    const [createRoomPassword, setCreateRoomPassword] = useState('');
    const [createRoomIsPublic, setCreateRoomIsPublic] = useState(false);
    const [autoCreateRoom, setAutoCreateRoom] = useState(false);
    const [autoRematch, setAutoRematch] = useState(false);
    const [isAutoPanelOpen, setIsAutoPanelOpen] = useState(false);
    const [isCreateRoomPanelOpen, setIsCreateRoomPanelOpen] = useState(false);
    const [isJoinRoomPanelOpen, setIsJoinRoomPanelOpen] = useState(false);
    const [botQueueText, setBotQueueText] = useState('');
    const [botQueueDelayMs, setBotQueueDelayMs] = useState('1000');
    const [botQueueAutoRefresh, setBotQueueAutoRefresh] = useState(true);
    const [botQueueStatus, setBotQueueStatus] = useState<BotQueueStatus | null>(null);
    const [isStartingBotQueue, setIsStartingBotQueue] = useState(false);
    const [isStoppingBotQueue, setIsStoppingBotQueue] = useState(false);
    const [isLoadingBotQueue, setIsLoadingBotQueue] = useState(false);

    const [userInfo, setUserInfo] = useState<UserInfo>(DEFAULT_USER_INFO);
    const [stats, setStats] = useState({ total: 0, received: 0, sent: 0, errors: 0 });
    const [matchStats, setMatchStats] = useState({ wins: 0, losses: 0 });
    const [myCorrectCount, setMyCorrectCount] = useState(0);
    const [myDiamonds, setMyDiamonds] = useState<number | null>(null);
    const [myBattleActivity, setMyBattleActivity] = useState<BattleActivityStats | null>(null);
    const [isLoadingBattleActivity, setIsLoadingBattleActivity] = useState(false);
    const [opponentCorrectCount, setOpponentCorrectCount] = useState(0);
    const [events, setEvents] = useState<LogEvent[]>([]);
    const [collectedVocabs, setCollectedVocabs] = useState<CollectedVocab[]>([]);
    const [serverCards, setServerCards] = useState<ServerCard[]>([]);
    const [serverDataStatus, setServerDataStatus] = useState('Chưa tải');
    const [serverLastSyncTime, setServerLastSyncTime] = useState('Chưa đồng bộ');
    const [isLoadingServerCards, setIsLoadingServerCards] = useState(false);
    const [serverSearch, setServerSearch] = useState('');
    const [isInBattle, setIsInBattle] = useState(false);
    const [isSearchingBattle, setIsSearchingBattle] = useState(false);
    const [canRematch, setCanRematch] = useState(false);
    const [battleToast, setBattleToast] = useState<BattleToast | null>(null);
    const [opponent, setOpponent] = useState<Opponent | null>(null);
    const [opponentBattleActivity, setOpponentBattleActivity] = useState<BattleActivityStats | null>(null);
    const [isLoadingOpponentBattleActivity, setIsLoadingOpponentBattleActivity] = useState(false);
    const [opponentBattleActivityError, setOpponentBattleActivityError] = useState('');
    const [isOpponentMessagesOpen, setIsOpponentMessagesOpen] = useState(false);
    const [opponentMessages, setOpponentMessages] = useState<OpponentMessage[]>([]);
    const [roundText, setRoundText] = useState('Round: -- / --');
    const [wordMask, setWordMask] = useState('_ _ _ _');
    const [wordMeaning, setWordMeaning] = useState('Chờ tải dữ liệu...');
    const [wordExample, setWordExample] = useState<{ en: string; vi: string }>({ en: '...', vi: '' });
    const [hintAudioUrl, setHintAudioUrl] = useState('');
    const [hintPhoneticText, setHintPhoneticText] = useState('');
    const [missingCardId, setMissingCardId] = useState<string | null>(null);
    const [llmGuessStatus, setLlmGuessStatus] = useState('');
    const [answerInput, setAnswerInput] = useState('');
    const [autoSend, setAutoSend] = useState(false);
    const [autoGuess, setAutoGuess] = useState(false);
    const [autoJoin, setAutoJoin] = useState(false);
    const [autoSyncAfterBattle, setAutoSyncAfterBattle] = useState(false);
    const [timeLeft, setTimeLeft] = useState(30);
    const [timerMessage, setTimerMessage] = useState('Thời gian round: Chờ trận...');

    const socketRef = useRef<WebSocket | null>(null);
    const hintAudioRef = useRef<HTMLAudioElement | null>(null);
    const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const currentCardIdRef = useRef<string | null>(null);
    const currentCardPayloadRef = useRef<any | null>(null);
    const currentRoundMetaRef = useRef<{ round: number; totalRounds: number } | null>(null);
    const activeRoundKeyRef = useRef('');
    const answerSentRef = useRef(false);
    const autoAnswerTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const llmGuessRequestRef = useRef(0);

    // FIX CRITICAL: Sử dụng Ref để lưu trữ map từ vựng, cập nhật đồng bộ, tránh React batching delay
    const serverCardMapRef = useRef<Map<string, string>>(new Map());

    const autoSendRef = useRef(false);
    const autoGuessRef = useRef(false);
    const autoJoinRef = useRef(false);
    const autoCreateRoomRef = useRef(false);
    const autoRematchRef = useRef(false);
    const autoConnectRef = useRef(false);
    const autoSyncAfterBattleRef = useRef(false);
    const autoRefreshTokenRef = useRef(false);
    const autoTimedRefreshTokenRef = useRef(false);
    const autoCheckInRef = useRef(false);
    const firebaseTokenRef = useRef('');
    const avoidUserIdsRef = useRef('');
    const apiKeyRef = useRef('');
    const refreshTokenValueRef = useRef('');
    const tokenRefreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const pendingTokenRefreshAfterBattleRef = useRef(false);
    const isInBattleRef = useRef(false);
    const isSearchingBattleRef = useRef(false);
    const isRefreshingRef = useRef(false);
    const manualDisconnectRef = useRef(false);
    const failedConnectionsRef = useRef(0);
    const pendingAutoJoinAfterReconnectRef = useRef(false);

    const opponentRef = useRef<Opponent | null>(null);
    const opponentBattleActivityRequestRef = useRef(0);
    const opponentBattleActivityCacheRef = useRef<Map<string, BattleActivityStats>>(new Map());
    const matchStatsRef = useRef({ wins: 0, losses: 0 });
    const userInfoRef = useRef<UserInfo>(DEFAULT_USER_INFO);
    const serverLoadingRef = useRef(false);
    const botQueuePollingRef = useRef<NodeJS.Timeout | null>(null);
    const initialBattleActivityLoadedRef = useRef(false);

    const applyFirebaseToken = (token: string, logSource = 'Manual Input', shouldLog = false) => {
        const cleanToken = token.trim();
        setFirebaseToken(cleanToken);
        firebaseTokenRef.current = cleanToken;
        localStorage.setItem('paroto_firebase_token', cleanToken);

        if (!cleanToken) {
            setUserInfo(DEFAULT_USER_INFO);
            userInfoRef.current = DEFAULT_USER_INFO;
            setCheckInToday(false);
            setCheckInStatusText('Chưa check-in hôm nay');
            return;
        }

        const updatedUserInfo = getUserInfoFromFirebaseToken(cleanToken);
        setUserInfo(updatedUserInfo);
        userInfoRef.current = updatedUserInfo;

        setTimeout(() => {
            syncCheckInTodayFromStorage();
            loadInitialBattleActivityOnce();
        }, 0);

        if (updatedUserInfo.userId === DEFAULT_USER_INFO.userId) {
            if (shouldLog) {
                pushLog('error', '🔴 Token không hợp lệ', 'Không decode được payload của firebaseToken JWT.');
            }
            return;
        }

        if (shouldLog) {
            pushLog('auth', '🔑 Firebase Token Payload', `${logSource}: UID=${updatedUserInfo.userId}, Email=${updatedUserInfo.email}`);
        }
    };

    const handleSetAutoSend = (val: boolean) => {
        setAutoSend(val);
        autoSendRef.current = val;
    };

    const handleSetAutoGuess = (val: boolean) => {
        setAutoGuess(val);
        autoGuessRef.current = val;
        localStorage.setItem('paroto_auto_guess', String(val));
    };

    const handleSetAutoJoin = (val: boolean) => {
        setAutoJoin(val);
        autoJoinRef.current = val;
    };

    const handleSetAutoCreateRoom = (val: boolean, createNow = false) => {
        setAutoCreateRoom(val);
        autoCreateRoomRef.current = val;
        localStorage.setItem('paroto_auto_create_room', String(val));

        pushLog(
            'auth',
            val ? '🟣 Auto Create Room ON' : '⚪ Auto Create Room OFF',
            val ? 'Đã bật tự động tạo phòng bằng cấu hình trong popup Tạo phòng.' : 'Đã tắt tự động tạo phòng.',
        );

        if (val && createNow) {
            setTimeout(() => {
                if (!autoCreateRoomRef.current) return;
                if (socketRef.current?.readyState === WebSocket.OPEN && !isInBattle && !isSearchingBattle) {
                    emitCreateBattleRoom('Auto Create Room');
                } else {
                    showBattleToast('info', 'Auto tạo phòng đã bật', 'Hệ thống sẽ tự tạo phòng khi socket sẵn sàng và không ở trong trận.');
                }
            }, 150);
        }
    };

    const handleSetAutoRematch = (val: boolean) => {
        setAutoRematch(val);
        autoRematchRef.current = val;
        localStorage.setItem('paroto_auto_rematch', String(val));

        pushLog('auth', val ? '🔁 Auto Rematch ON' : '⚪ Auto Rematch OFF', val ? 'Đã bật tự động tái đấu khi trận kết thúc.' : 'Đã tắt tự động tái đấu.');
    };

    const handleSetAutoConnect = (val: boolean) => {
        setAutoConnect(val);
        autoConnectRef.current = val;
        localStorage.setItem('paroto_auto_connect', String(val));

        if (val && socketRef.current?.readyState !== WebSocket.OPEN && socketStatus === 'disconnected') {
            pushLog('auth', '🟢 Auto Connect', 'Đã bật tự động kết nối socket.');
            setTimeout(() => {
                if (autoConnectRef.current && socketRef.current?.readyState !== WebSocket.OPEN) {
                    connectSocket();
                }
            }, 300);
        }
    };

    const handleSetAutoSyncAfterBattle = (val: boolean) => {
        setAutoSyncAfterBattle(val);
        autoSyncAfterBattleRef.current = val;
        localStorage.setItem('paroto_auto_sync_after_battle', String(val));
    };

    const handleSetAutoRefreshToken = (val: boolean) => {
        setAutoRefreshToken(val);
        autoRefreshTokenRef.current = val;
        localStorage.setItem('paroto_auto_refresh_token', String(val));
    };

    const handleSetAutoTimedRefreshToken = (val: boolean) => {
        setAutoTimedRefreshToken(val);
        autoTimedRefreshTokenRef.current = val;
        localStorage.setItem('paroto_auto_refresh_token_30m', String(val));

        if (val) {
            startTimedTokenRefresh();
            pushLog(
                'auth',
                '⏱️ Auto Refresh 30p ON',
                'Đã bật tự động refresh_token mỗi 30 phút. Nếu đang trong trận, hệ thống sẽ chờ game-over rồi mới refresh.',
            );
        } else {
            stopTimedTokenRefresh('Đã tắt tự động refresh_token mỗi 30 phút.');
            pushLog('auth', '⚪ Auto Refresh 30p OFF', 'Đã tắt tự động refresh_token định kỳ.');
        }
    };

    const handleSetAutoCheckIn = (val: boolean) => {
        setAutoCheckIn(val);
        autoCheckInRef.current = val;
        localStorage.setItem('paroto_auto_checkin', String(val));

        pushLog(
            'auth',
            val ? '💎 Auto Check-in ON' : '⚪ Auto Check-in OFF',
            val ? 'Đã bật tự động check-in. Nếu hôm nay chưa check-in thì hệ thống sẽ gọi API một lần.' : 'Đã tắt tự động check-in.',
        );

        if (val) {
            setTimeout(() => {
                if (autoCheckInRef.current) {
                    handleCheckIn(true);
                }
            }, 300);
        }
    };

    const handleSetBotQueueAutoRefresh = (val: boolean) => {
        setBotQueueAutoRefresh(val);
        localStorage.setItem('paroto_bot_queue_auto_refresh', String(val));
    };

    const handleAvoidUserIdsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setAvoidUserIds(value);
        avoidUserIdsRef.current = value;
        localStorage.setItem('paroto_avoid_user_ids', value);
    };

    const handleAutoOutMatchedOpponent = (matchedOpponent: Opponent | null) => {
        if (!matchedOpponent?.userId) return false;

        const avoidIds = getAvoidUserIdList(avoidUserIdsRef.current);
        const opponentId = matchedOpponent.userId.trim().toLowerCase();

        if (!avoidIds.includes(opponentId)) return false;

        pushLog(
            'auth',
            '🚪 Auto Out',
            `Gặp đúng UID cần né: ${matchedOpponent.userId}${matchedOpponent.displayName ? ` (${matchedOpponent.displayName})` : ''} -> tự động thoát trận.`,
        );

        setIsInBattle(false);
        setIsSearchingBattle(false);
        setCanRematch(false);
        setOpponent(null);
        resetOpponentBattleActivity();
        setIsOpponentMessagesOpen(false);
        setOpponentMessages([]);
        opponentRef.current = null;
        currentCardIdRef.current = null;
        stopRoundTimer('Đã tự động out do gặp UID cần né 🚪');
        disconnectSocket();
        return true;
    };

    const handleRefreshFirebaseToken = async () => {
        if (isRefreshingRef.current) {
            pushLog('auth', '⏭️ Bỏ qua Refresh Token', 'Đang có một lượt refresh_token chạy, không gọi trùng.');
            return false;
        }

        const currentApiKey = (apiKeyRef.current || apiKey).trim();
        const currentRefreshToken = (refreshTokenValueRef.current || refreshToken).trim();

        if (!currentApiKey || !currentRefreshToken) {
            pushLog('error', '🔴 Đổi Token thất bại', 'Thiếu API Key hoặc Refresh Token để thực hiện gia hạn.');
            return false;
        }

        isRefreshingRef.current = true;
        setIsRefreshing(true);
        pushLog('auth', '🔄 Đang làm mới Token', 'Đang gửi yêu cầu làm mới access token tới Go API Server...');

        try {
            const response = await axios.post(
                `${API_BASE_URL}/refresh-token`,
                {
                    key: currentApiKey,
                    refresh_token: currentRefreshToken,
                },
                { timeout: 10000 },
            );

            if (response.status === 200) {
                const data = response.data;
                const newAccessToken = data.id_token || data.access_token;
                const newRefreshToken = data.refresh_token;

                if (newAccessToken) {
                    pushLog('auth', '✨ Token mới đã cập nhật', `Đổi thành công! User ID: ${data.user_id || 'N/A'}`);

                    applyFirebaseToken(newAccessToken, 'Auto Refresh API', true);
                    if (newRefreshToken) {
                        setRefreshToken(newRefreshToken);
                        refreshTokenValueRef.current = newRefreshToken;
                        localStorage.setItem('paroto_refresh_token', newRefreshToken);
                    }

                    failedConnectionsRef.current = 0;
                    isRefreshingRef.current = false;
                    setIsRefreshing(false);
                    return true;
                }
            }
            throw new Error('Không lấy được access_token/id_token hợp lệ từ phản hồi.');
        } catch (err: any) {
            const errMsg = err.response?.data?.message || err.message;
            pushLog('error', '🔴 Lỗi khi gọi API Refresh Token', errMsg);
            isRefreshingRef.current = false;
            setIsRefreshing(false);
            return false;
        }
    };

    const getTimeLabel = () => new Date().toLocaleTimeString('vi-VN', { hour12: false } as any);

    const stopTimedTokenRefresh = (message = 'Auto refresh 30p: OFF') => {
        if (tokenRefreshIntervalRef.current) {
            clearInterval(tokenRefreshIntervalRef.current);
            tokenRefreshIntervalRef.current = null;
        }

        pendingTokenRefreshAfterBattleRef.current = false;
        setScheduledRefreshStatus(message);
    };

    const runTimedTokenRefresh = async (source: 'interval' | 'after-battle' = 'interval') => {
        if (!autoTimedRefreshTokenRef.current) return false;

        if (isInBattleRef.current || isSearchingBattleRef.current) {
            pendingTokenRefreshAfterBattleRef.current = true;
            const msg = 'Đến giờ refresh nhưng đang trong trận, sẽ refresh sau khi game-over.';
            setScheduledRefreshStatus(msg);
            pushLog('auth', '⏳ Hoãn refresh_token', msg);
            return false;
        }

        pendingTokenRefreshAfterBattleRef.current = false;
        setScheduledRefreshStatus(source === 'after-battle' ? 'Đang refresh sau game-over...' : 'Đang refresh định kỳ 30 phút...');

        const ok = await handleRefreshFirebaseToken();
        if (ok) {
            const msg = `Đã refresh_token lúc ${getTimeLabel()}`;
            setScheduledRefreshStatus(msg);
            pushLog('auth', source === 'after-battle' ? '✅ Refresh sau game-over' : '✅ Refresh định kỳ', msg);
        } else {
            setScheduledRefreshStatus(`Refresh_token lỗi lúc ${getTimeLabel()}`);
        }

        return ok;
    };

    const startTimedTokenRefresh = () => {
        if (tokenRefreshIntervalRef.current) {
            clearInterval(tokenRefreshIntervalRef.current);
            tokenRefreshIntervalRef.current = null;
        }

        setScheduledRefreshStatus('Đã bật auto refresh_token mỗi 30 phút.');

        tokenRefreshIntervalRef.current = setInterval(() => {
            runTimedTokenRefresh('interval');
        }, TOKEN_REFRESH_INTERVAL_MS);
    };

    const botQueueInputBots = useMemo(() => parseBotQueueInput(botQueueText), [botQueueText]);

    const botQueueDisplayRows = useMemo(() => {
        const serverBots = botQueueStatus?.bots || [];
        if (serverBots.length > 0) return serverBots;

        return botQueueInputBots.map((bot) => ({
            botId: bot.botId,
            userId: bot.userId,
            email: bot.email,
            status: 'draft',
            lastEvent: 'Chưa gửi server',
        }));
    }, [botQueueInputBots, botQueueStatus]);

    const botQueueSummary = useMemo(() => {
        const counts = botQueueDisplayRows.reduce<Record<string, number>>((acc, bot) => {
            const status = (bot.status || 'unknown').toLowerCase();
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {});

        return {
            total: botQueueDisplayRows.length,
            waiting: counts.waiting || 0,
            searching: counts.searching || 0,
            inBattle: counts.in_battle || 0,
            error: counts.error || 0,
            stopped: counts.stopped || 0,
        };
    }, [botQueueDisplayRows]);

    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);

        const cachedStats = localStorage.getItem('paroto_match_stats');
        if (cachedStats) {
            try {
                const pStats = JSON.parse(cachedStats);
                setMatchStats(pStats);
                matchStatsRef.current = pStats;
            } catch {
                /* ignore */
            }
        }

        const cachedAutoConnect = localStorage.getItem('paroto_auto_connect') === 'true';
        setAutoConnect(cachedAutoConnect);
        autoConnectRef.current = cachedAutoConnect;

        const cachedAutoGuess = localStorage.getItem('paroto_auto_guess') === 'true';
        setAutoGuess(cachedAutoGuess);
        autoGuessRef.current = cachedAutoGuess;

        const cachedAutoSyncAfterBattle = localStorage.getItem('paroto_auto_sync_after_battle') === 'true';
        setAutoSyncAfterBattle(cachedAutoSyncAfterBattle);
        autoSyncAfterBattleRef.current = cachedAutoSyncAfterBattle;

        const cachedAutoRefresh = localStorage.getItem('paroto_auto_refresh_token') === 'true';
        setAutoRefreshToken(cachedAutoRefresh);
        autoRefreshTokenRef.current = cachedAutoRefresh;

        const cachedAutoTimedRefresh = localStorage.getItem('paroto_auto_refresh_token_30m') === 'true';
        setAutoTimedRefreshToken(cachedAutoTimedRefresh);
        autoTimedRefreshTokenRef.current = cachedAutoTimedRefresh;

        const cachedAutoCheckIn = localStorage.getItem('paroto_auto_checkin') === 'true';
        setAutoCheckIn(cachedAutoCheckIn);
        autoCheckInRef.current = cachedAutoCheckIn;

        const cachedApiKey = localStorage.getItem('paroto_api_key') || '';
        setApiKey(cachedApiKey);
        apiKeyRef.current = cachedApiKey;

        const cachedRefreshToken = localStorage.getItem('paroto_refresh_token') || '';
        setRefreshToken(cachedRefreshToken);
        refreshTokenValueRef.current = cachedRefreshToken;

        const cachedAvoidUserIds = localStorage.getItem('paroto_avoid_user_ids') || '';
        setAvoidUserIds(cachedAvoidUserIds);
        avoidUserIdsRef.current = cachedAvoidUserIds;

        const cachedBattleRoomId = localStorage.getItem('paroto_battle_room_id') || '';
        setBattleRoomId(cachedBattleRoomId);

        const cachedBattleRoomPassword = localStorage.getItem('paroto_battle_room_password') || '';
        setBattleRoomPassword(cachedBattleRoomPassword);

        const cachedCreateRoomPassword = localStorage.getItem('paroto_create_room_password') || '';
        setCreateRoomPassword(cachedCreateRoomPassword);

        const cachedCreateRoomIsPublic = localStorage.getItem('paroto_create_room_is_public') === 'true';
        setCreateRoomIsPublic(cachedCreateRoomIsPublic);

        const cachedAutoCreateRoom = localStorage.getItem('paroto_auto_create_room') === 'true';
        setAutoCreateRoom(cachedAutoCreateRoom);
        autoCreateRoomRef.current = cachedAutoCreateRoom;

        const cachedAutoRematch = localStorage.getItem('paroto_auto_rematch') === 'true';
        setAutoRematch(cachedAutoRematch);
        autoRematchRef.current = cachedAutoRematch;

        const cachedBotQueueText = localStorage.getItem('paroto_bot_queue_list') || '';
        setBotQueueText(cachedBotQueueText);

        const cachedBotQueueDelay = localStorage.getItem('paroto_bot_queue_delay_ms') || '1000';
        setBotQueueDelayMs(cachedBotQueueDelay);

        const cachedBotQueueAutoRefresh = localStorage.getItem('paroto_bot_queue_auto_refresh') !== 'false';
        setBotQueueAutoRefresh(cachedBotQueueAutoRefresh);

        try {
            const cachedFirebaseToken =
                localStorage.getItem('paroto_firebase_token') || localStorage.getItem('firebaseToken') || localStorage.getItem('firebase_token') || '';

            if (cachedFirebaseToken) {
                applyFirebaseToken(cachedFirebaseToken, 'Auto Load Token', true);
            }

            setTimeout(() => {
                syncCheckInTodayFromStorage();

                if (cachedAutoCheckIn && cachedFirebaseToken) {
                    handleCheckIn(true);
                }
            }, 500);
        } catch (err) {
            pushLog('error', '🔴 Lỗi đọc firebaseToken', String(err));
        }

        loadCardsFromApi();

        if (cachedAutoConnect) {
            setTimeout(() => {
                if (autoConnectRef.current && socketRef.current?.readyState !== WebSocket.OPEN) {
                    connectSocket();
                }
            }, 500);
        }

        return () => {
            if (socketRef.current) socketRef.current.close();
            if (hintAudioRef.current) hintAudioRef.current.pause();
            if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
            if (autoAnswerTimeoutRef.current) clearTimeout(autoAnswerTimeoutRef.current);
            if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
            if (tokenRefreshIntervalRef.current) clearInterval(tokenRefreshIntervalRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        isInBattleRef.current = isInBattle;
    }, [isInBattle]);

    useEffect(() => {
        isSearchingBattleRef.current = isSearchingBattle;
    }, [isSearchingBattle]);

    // useEffect(() => {
    //   if (!botQueueAutoRefresh) {
    //     if (botQueuePollingRef.current) clearInterval(botQueuePollingRef.current);
    //     botQueuePollingRef.current = null;
    //     return;
    //   }

    //   loadBotQueueStatus(true);
    //   botQueuePollingRef.current = setInterval(() => {
    //     loadBotQueueStatus(true);
    //   }, 4000);

    //   return () => {
    //     if (botQueuePollingRef.current) clearInterval(botQueuePollingRef.current);
    //     botQueuePollingRef.current = null;
    //   };
    //   // eslint-disable-next-line react-hooks/exhaustive-deps
    // }, [botQueueAutoRefresh]);

    const pushLog = (direction: LogEvent['direction'], type: string, data: any) => {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('vi-VN', { hour12: false, fractionalSecondDigits: 3 } as any);
        const newEvent: LogEvent = {
            id: Math.random().toString(36).substring(2, 9),
            direction,
            type,
            data,
            time: timeStr,
        };
        setEvents((prev) => [newEvent, ...prev].slice(0, 500));
        setStats((prev) => ({
            ...prev,
            total: prev.total + 1,
            received: direction === 'in' ? prev.received + 1 : prev.received,
            sent: direction === 'out' ? prev.sent + 1 : prev.sent,
            errors: direction === 'error' ? prev.errors + 1 : prev.errors,
        }));
    };

    const showBattleToast = (type: BattleToast['type'], title: string, message: string) => {
        if (toastTimeoutRef.current) {
            clearTimeout(toastTimeoutRef.current);
            toastTimeoutRef.current = null;
        }

        const toast: BattleToast = {
            id: Math.random().toString(36).substring(2, 9),
            type,
            title,
            message,
        };

        setBattleToast(toast);
        toastTimeoutRef.current = setTimeout(() => {
            setBattleToast((current) => (current?.id === toast.id ? null : current));
            toastTimeoutRef.current = null;
        }, 4500);
    };

    const getSaigonDateKey = () => {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Saigon',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(new Date());

        const year = parts.find((p) => p.type === 'year')?.value || '';
        const month = parts.find((p) => p.type === 'month')?.value || '';
        const day = parts.find((p) => p.type === 'day')?.value || '';

        return `${year}-${month}-${day}`;
    };

    const getCheckInStorageKey = () => {
        const uid = userInfoRef.current.userId || 'unknown';
        return `paroto_checkin_${uid}_${getSaigonDateKey()}`;
    };

    const syncCheckInTodayFromStorage = () => {
        const key = getCheckInStorageKey();
        const cached = localStorage.getItem(key);

        if (!cached) {
            setCheckInToday(false);
            setCheckInStatusText('Chưa check-in hôm nay');
            return false;
        }

        try {
            const data = JSON.parse(cached) as CheckInCache;

            setCheckInToday(true);
            setCheckInStatusText(data.reward ? `Đã check-in hôm nay • +${data.reward} kim cương` : data.message || 'Đã check-in hôm nay');
        } catch {
            setCheckInToday(true);
            setCheckInStatusText('Đã check-in hôm nay');
        }

        return true;
    };

    const markCheckInToday = (response: CheckInApiResponse) => {
        const data = response.data;

        const cacheData: CheckInCache = {
            date: getSaigonDateKey(),
            checkedAt: new Date().toISOString(),
            message: response.message || 'Đã check-in hôm nay',
            reward: data?.daily_reward_diamonds,
            currentStreak: data?.current_streak,
        };

        localStorage.setItem(getCheckInStorageKey(), JSON.stringify(cacheData));

        setCheckInToday(true);
        setCheckInStatusText(
            data?.daily_reward_diamonds ? `Đã check-in hôm nay • +${data.daily_reward_diamonds} kim cương` : response.message || 'Đã check-in hôm nay',
        );
    };

    const handleCheckIn = async (silent = false) => {
        if (syncCheckInTodayFromStorage()) {
            if (!silent) {
                pushLog('auth', '✅ Check-in', 'Hôm nay đã check-in rồi, bỏ qua không gọi API.');
                showBattleToast('info', 'Đã check-in hôm nay', 'Không gọi lại API để tránh điểm danh trùng.');
            }

            return true;
        }

        const token = firebaseTokenRef.current.trim();

        if (!token) {
            if (!silent) {
                pushLog('error', '🔴 Check-in thất bại', 'Thiếu Firebase Token.');
                showBattleToast('error', 'Thiếu token', 'Hãy nhập Firebase Token trước khi check-in.');
            }

            return false;
        }

        setIsCheckingIn(true);

        if (!silent) {
            pushLog('auth', '💎 Check-in', 'Đang gọi API check-in...');
        }

        try {
            const res = await axios.post<CheckInApiResponse>(
                `${API_BASE_URL}/check-in`,
                {},
                {
                    timeout: 10000,
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'X-User-Timezone': 'Asia/Saigon',
                        'Content-Type': 'application/json',
                    },
                },
            );

            const response = res.data;

            if (response.status === 'success') {
                markCheckInToday(response);

                const reward = response.data?.daily_reward_diamonds || 0;
                const streak = response.data?.current_streak || 0;
                const already = response.data?.already_counted_today;

                pushLog(
                    'auth',
                    already ? '✅ Đã check-in trước đó' : '💎 Check-in thành công',
                    `${response.message} | Streak=${streak} | Reward=+${reward} kim cương`,
                );

                showBattleToast(
                    'success',
                    already ? 'Đã check-in hôm nay' : 'Check-in thành công',
                    reward ? `Nhận +${reward} kim cương. Streak hiện tại: ${streak}` : response.message,
                );

                return true;
            }

            throw new Error(response.message || 'Check-in không thành công.');
        } catch (err: any) {
            const message = err.response?.data?.message || err.message || 'Lỗi không xác định';

            pushLog('error', '🔴 Check-in lỗi', message);

            if (!silent) {
                showBattleToast('error', 'Check-in thất bại', message);
            }

            return false;
        } finally {
            setIsCheckingIn(false);
        }
    };

    const normalizeBattleActivityStats = (activity: any): BattleActivityStats => ({
        elo: activity.elo,
        totalGames: activity.totalGames || 0,
        totalWins: activity.totalWins || 0,
        totalLosses: activity.totalLosses || 0,
        totalDraws: activity.totalDraws || 0,
        totalRoundsWon: activity.totalRoundsWon || 0,
        totalDiamondsWon: activity.totalDiamondsWon || 0,
        totalDiamondsLost: activity.totalDiamondsLost || 0,
        updatedAt: activity.updatedAt || activity.lastPlayedAt,
    });

    const resetOpponentBattleActivity = () => {
        opponentBattleActivityRequestRef.current += 1;
        setOpponentBattleActivity(null);
        setOpponentBattleActivityError('');
        setIsLoadingOpponentBattleActivity(false);
    };

    const loadOpponentBattleActivity = async (targetOpponent: Opponent | null, source: 'game-start' | 'manual' = 'game-start') => {
        const userId = String(targetOpponent?.userId || '').trim();
        const token = firebaseTokenRef.current.trim();

        opponentBattleActivityRequestRef.current += 1;
        const requestId = opponentBattleActivityRequestRef.current;

        setOpponentBattleActivityError('');

        if (!userId) {
            setOpponentBattleActivity(null);
            setIsLoadingOpponentBattleActivity(false);
            return null;
        }

        const cached = opponentBattleActivityCacheRef.current.get(userId);
        if (cached) {
            setOpponentBattleActivity(cached);
            setIsLoadingOpponentBattleActivity(false);
            pushLog('auth', '📈 ELO đối thủ cache', `UID=${userId} | ELO=${cached.elo} | Games=${cached.totalGames}`);
            return cached;
        }

        if (!token) {
            setOpponentBattleActivity(null);
            setOpponentBattleActivityError('Thiếu Firebase Token');
            setIsLoadingOpponentBattleActivity(false);
            pushLog('error', '🔴 Load ELO đối thủ thất bại', 'Thiếu Firebase Token.');
            return null;
        }

        setOpponentBattleActivity(null);
        setIsLoadingOpponentBattleActivity(true);

        try {
            const res = await axios.get(`${API_BASE_URL}/battle-activity`, {
                timeout: 10000,
                params: {
                    userId,
                },
                headers: {
                    Authorization: `Bearer ${token}`,
                    'X-User-Timezone': 'Asia/Saigon',
                },
            });

            const activity = res.data?.data;
            if (!activity || typeof activity.elo !== 'number') {
                throw new Error(res.data?.message || 'Không lấy được dữ liệu ELO hợp lệ.');
            }

            const normalized = normalizeBattleActivityStats(activity);
            opponentBattleActivityCacheRef.current.set(userId, normalized);

            if (requestId !== opponentBattleActivityRequestRef.current || opponentRef.current?.userId !== userId) {
                return normalized;
            }

            setOpponentBattleActivity(normalized);
            setOpponentBattleActivityError('');

            pushLog(
                'auth',
                source === 'game-start' ? '📈 ELO đối thủ' : '📈 Check ELO đối thủ',
                `UID=${userId} | ELO=${normalized.elo} | Games=${normalized.totalGames} | Wins=${normalized.totalWins} | Losses=${normalized.totalLosses}`,
            );

            return normalized;
        } catch (err: any) {
            const message = err.response?.data?.message || err.message || 'Lỗi không xác định';

            if (requestId === opponentBattleActivityRequestRef.current) {
                setOpponentBattleActivity(null);
                setOpponentBattleActivityError(message);
            }

            pushLog('error', '🔴 Load ELO đối thủ lỗi', message);
            return null;
        } finally {
            if (requestId === opponentBattleActivityRequestRef.current) {
                setIsLoadingOpponentBattleActivity(false);
            }
        }
    };

    const loadBattleActivity = async (source: 'manual' | 'game-over' | 'initial' = 'manual') => {
        const userId = userInfoRef.current.userId;
        const token = firebaseTokenRef.current.trim();

        if (!userId || userId === DEFAULT_USER_INFO.userId) {
            if (source === 'manual') {
                pushLog('error', '🔴 Load ELO thất bại', 'Không xác định được userId từ Firebase Token.');
            }
            return null;
        }

        if (!token) {
            if (source === 'manual') {
                pushLog('error', '🔴 Load ELO thất bại', 'Thiếu Firebase Token.');
            }
            return null;
        }

        setIsLoadingBattleActivity(true);

        try {
            const res = await axios.get(`${API_BASE_URL}/battle-activity`, {
                timeout: 10000,
                params: {
                    userId,
                },
                headers: {
                    Authorization: `Bearer ${token}`,
                    'X-User-Timezone': 'Asia/Saigon',
                },
            });
            const activity = res.data?.data;
            if (!activity || typeof activity.elo !== 'number') {
                throw new Error(res.data?.message || 'Không lấy được dữ liệu ELO hợp lệ.');
            }

            const normalized = normalizeBattleActivityStats(activity);

            setMyBattleActivity(normalized);

            pushLog(
                'auth',
                source === 'game-over' ? '📈 ELO sau trận' : source === 'initial' ? '📈 ELO ban đầu' : '📈 Load ELO',
                `ELO=${normalized.elo} | Games=${normalized.totalGames} | Wins=${normalized.totalWins} | Losses=${normalized.totalLosses}`,
            );

            return normalized;
        } catch (err: any) {
            const message = err.response?.data?.message || err.message || 'Lỗi không xác định';
            pushLog('error', '🔴 Load ELO lỗi', message);
            return null;
        } finally {
            setIsLoadingBattleActivity(false);
        }
    };

    const loadInitialBattleActivityOnce = () => {
        if (initialBattleActivityLoadedRef.current) return;

        const userId = userInfoRef.current.userId;
        const token = firebaseTokenRef.current.trim();

        if (!token) return;
        if (!userId || userId === DEFAULT_USER_INFO.userId) return;

        initialBattleActivityLoadedRef.current = true;

        setTimeout(() => {
            loadBattleActivity('initial');
        }, 500);
    };

    const loadCardsFromApi = async () => {
        if (serverLoadingRef.current) return;

        serverLoadingRef.current = true;
        setIsLoadingServerCards(true);
        setServerDataStatus('Đang tải...');

        try {
            const res = await axios.get(`${API_BASE_URL}/cards`, { timeout: 5000 });
            const rawData = Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : [];
            const normalized: ServerCard[] = rawData
                .map((item: any) => ({
                    id: item.id ?? null,
                    card_id: String(item.card_id || item.cardId || '').trim(),
                    word: String(item.word || item.Word || '').trim(),
                    source: item.source || 'server',
                }))
                .filter((item: any) => item.card_id && item.word);

            const syncedAt = new Date().toLocaleTimeString('vi-VN', { hour12: false } as any);
            setServerCards(normalized);

            // FIX CRITICAL: Nạp trực tiếp dữ liệu đồng bộ vào Ref khi API tải về thành công
            serverCardMapRef.current.clear();
            normalized.forEach((card) => {
                if (card.card_id) serverCardMapRef.current.set(card.card_id, card.word);
            });

            setServerDataStatus(`Đã nạp ${normalized.length.toLocaleString('vi-VN')} từ`);
            setServerLastSyncTime(syncedAt);
            pushLog('auth', '🌐 API Load', `Đã đồng bộ ${normalized.length.toLocaleString('vi-VN')} từ vựng từ Server Go lúc ${syncedAt}.`);
        } catch (err: any) {
            setServerDataStatus('Lỗi kết nối');
            pushLog('error', '🔴 API Load Failed', `Không kết nối được API Go backend: ${err.message}`);
        } finally {
            serverLoadingRef.current = false;
            setIsLoadingServerCards(false);
        }
    };

    const syncWordToApi = async (cardId: string, word: string) => {
        try {
            const res = await axios.post(`${API_BASE_URL}/cards`, { card_id: cardId, word }, { timeout: 5000 });
            if (res.status === 201) {
                const saved = res.data?.data;
                updateServerCardState(cardId, word, saved?.id || null, 'server');
                pushLog('auth', '🌐 API Sync', `Đã đồng bộ lên database server: [${word}]`);
            }
        } catch (err: any) {
            if (err.response?.status === 409) {
                updateServerCardState(cardId, word, null, 'server');
            } else {
                pushLog('error', '🔴 API Sync Error', `Lỗi đẩy từ vựng lên API: ${err.message}`);
            }
        }
    };

    const syncCardToCollectionJson = async (params: { card: any; word: string; sourceEvent: string; round?: number; totalRounds?: number }) => {
        const cardId = String(params.card?.cardId || params.card?.card_id || currentCardIdRef.current || '').trim();
        const cleanWord = normalizeAnswer(params.word);

        if (!cardId || !cleanWord || !params.card) {
            pushLog('error', '🔴 Collection JSON Error', 'Thiếu card/cardId/word, không ghi được COLLECTION/data.json.');
            return false;
        }

        const collectedAt = new Date().toISOString();
        const cardForJson = {
            ...params.card,
            cardId,
            data: {
                ...(params.card?.data && typeof params.card.data === 'object' ? params.card.data : {}),
                word: cleanWord,
                answer: cleanWord,
                collectedAt,
                sourceEvent: params.sourceEvent,
                round: params.round,
                totalRounds: params.totalRounds,
            },
        };

        try {
            const res = await axios.post(`${API_BASE_URL}/collection/cards`, { card: cardForJson }, { timeout: 8000 });

            const data = res.data?.data || {};
            pushLog('auth', '📁 Collection JSON', `Đã ghi [${cleanWord}] vào COLLECTION/data.json. Total=${data.total ?? 'N/A'}`);

            return true;
        } catch (err: any) {
            pushLog('error', '🔴 Collection JSON Error', `Không ghi được COLLECTION/data.json: ${err.response?.data?.message || err.message}`);

            return false;
        }
    };

    const updateServerCardState = (cardId: string, word: string, id: number | null, source: string) => {
        // FIX CRITICAL: Cập nhật Ref ngay lập tức để đồng bộ hóa các sự kiện kế tiếp
        serverCardMapRef.current.set(cardId, word);

        setServerCards((prev) => {
            const exists = prev.some((c) => c.card_id === cardId);
            if (exists) {
                return prev.map((c) => (c.card_id === cardId ? { ...c, word, source, id: id ?? c.id } : c));
            } else {
                return [{ id, card_id: cardId, word, source }, ...prev];
            }
        });
    };

    const clearPendingAutoAnswer = () => {
        if (autoAnswerTimeoutRef.current) {
            clearTimeout(autoAnswerTimeoutRef.current);
            autoAnswerTimeoutRef.current = null;
        }
    };

    const normalizeAnswer = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

    const getLateRoundDelayMs = (totalTimeMs?: number) => {
        const totalMs = Number(totalTimeMs) > 0 ? Number(totalTimeMs) : 30000;
        const remainingMs = Math.floor(Math.random() * 5001) + 18000; // gửi khi còn ngẫu nhiên 5-10s
        const delayMs = Math.max(500, totalMs - remainingMs);

        return {
            totalMs,
            remainingMs: Math.min(remainingMs, totalMs),
            delayMs,
        };
    };

    const isAnswerFitMask = (answer: string, mask?: string) => {
        const cleanAnswer = normalizeAnswer(answer);
        const cleanMask = String(mask || '')
            .trim()
            .toLowerCase();

        if (!cleanAnswer || !cleanMask || !cleanMask.includes('_')) return true;
        if (cleanAnswer.length !== cleanMask.length) return false;

        for (let i = 0; i < cleanMask.length; i++) {
            const maskChar = cleanMask[i];
            const answerChar = cleanAnswer[i];

            if (maskChar === ' ' && answerChar !== ' ') return false;
            if (maskChar === '_' && !/[a-z]/.test(answerChar)) return false;
            if (maskChar !== '_' && maskChar !== ' ' && maskChar !== answerChar) return false;
        }

        return true;
    };

    const sendAutoAnswerOnce = (answer: string, source: string, cardId?: string, roundKey?: string) => {
        const cleanAnswer = normalizeAnswer(answer);

        if (!cleanAnswer) return;

        if (!autoSendRef.current) {
            pushLog('auth', '⏸️ Auto Answer OFF', `Đã có đáp án [${cleanAnswer}] từ ${source}, nhưng Auto Answer đang tắt.`);
            return;
        }

        if (roundKey && activeRoundKeyRef.current !== roundKey) {
            pushLog('auth', '⏭️ Bỏ qua đáp án cũ', `Đáp án [${cleanAnswer}] thuộc round cũ nên không gửi.`);
            return;
        }

        if (cardId && currentCardIdRef.current !== cardId) {
            pushLog('auth', '⏭️ Bỏ qua đáp án cũ', `Card ID hiện tại đã đổi, không gửi đáp án [${cleanAnswer}].`);
            return;
        }

        if (answerSentRef.current) {
            pushLog('auth', '⏭️ Chặn gửi trùng', `Round này đã gửi 1 đáp án, bỏ qua [${cleanAnswer}].`);
            return;
        }

        if (socketRef.current?.readyState !== WebSocket.OPEN) {
            pushLog('error', '🔴 Auto Answer Failed', 'Socket chưa sẵn sàng, không gửi được đáp án.');
            return;
        }

        answerSentRef.current = true;
        clearPendingAutoAnswer();

        socketRef.current.send('42' + JSON.stringify(['vocab-battle-answer', { answer: cleanAnswer }]));
        pushLog('out', `🎯 Gửi đáp án (${source})`, `["vocab-battle-answer", {"answer":"${cleanAnswer}"}]`);
        setAnswerInput('');
    };

    const scheduleLateAutoAnswer = (params: { answer: string; source: string; cardId?: string; roundKey?: string; totalTimeMs?: number }) => {
        const cleanAnswer = normalizeAnswer(params.answer);

        if (!cleanAnswer) return;

        if (!autoSendRef.current) {
            pushLog('auth', '⏸️ Auto Answer OFF', `LLM đã đoán [${cleanAnswer}], nhưng Auto Answer đang tắt nên chỉ điền vào ô đáp án.`);
            return;
        }

        if (answerSentRef.current) {
            pushLog('auth', '⏭️ Không hẹn gửi', `Round này đã gửi đáp án trước đó, bỏ qua [${cleanAnswer}].`);
            return;
        }

        clearPendingAutoAnswer();

        const { delayMs, remainingMs } = getLateRoundDelayMs(params.totalTimeMs);

        autoAnswerTimeoutRef.current = setTimeout(() => {
            sendAutoAnswerOnce(cleanAnswer, params.source, params.cardId, params.roundKey);
        }, delayMs);

        pushLog(
            'auth',
            '🤖 Hẹn gửi đáp án LLM',
            `Đoán [${cleanAnswer}] -> sẽ gửi sau ${(delayMs / 1000).toFixed(1)}s, khi còn khoảng ${(remainingMs / 1000).toFixed(1)}s.`,
        );
    };

    const guessMissingCardWithLLM = async (eventData: any, roundKey: string) => {
        const card = eventData?.card;
        const cardId = String(card?.cardId || '').trim();

        if (!card || !cardId) return;

        const requestId = llmGuessRequestRef.current + 1;
        llmGuessRequestRef.current = requestId;
        setLlmGuessStatus('Đang gọi LLM để đoán từ...');
        pushLog('auth', '🧠 LLM Guess', `Không tìm thấy card_id [${cardId}] trên server -> gọi API đoán từ.`);

        try {
            const guessPayload: LLMGuessPayload = {
                wordLength: Number(card.wordLength || 0),
                wordMask: String(card.wordMask || '').trim(),
                letterCount: Number(card.letterCount || 0),
                explanation_en: String(card.explanation?.en || '').trim(),
                exampleMasked_en: String(card.exampleMasked?.en || '').trim(),
                type: String(card.type || '').trim(),
            };

            if (!guessPayload.explanation_en && !guessPayload.exampleMasked_en) {
                setLlmGuessStatus('Thiếu clue tiếng Anh để gọi LLM.');
                pushLog('error', '🔴 LLM Guess Payload Invalid', `Card ID [${cardId}] thiếu explanation.en và exampleMasked.en nên không gọi /guess-word.`);
                return;
            }

            pushLog('auth', '📤 LLM Guess Payload', guessPayload);

            const response = await axios.post<LLMGuessApiResponse>(`${API_BASE_URL}/guess-word`, guessPayload, { timeout: 35000 });

            if (requestId !== llmGuessRequestRef.current || activeRoundKeyRef.current !== roundKey || currentCardIdRef.current !== cardId) {
                pushLog('auth', '⏭️ Bỏ qua LLM Guess', `Kết quả đoán cho card_id [${cardId}] đã cũ, không dùng nữa.`);
                return;
            }

            const guess = response.data?.guess;
            const guessedAnswer = normalizeAnswer(guess?.answer || '');

            if (!guess || !guessedAnswer) {
                setLlmGuessStatus('LLM không trả về đáp án hợp lệ.');
                pushLog('error', '🔴 LLM Guess Failed', `Không nhận được đáp án hợp lệ cho card_id [${cardId}]. Response=${JSON.stringify(response.data)}`);
                return;
            }

            if (!isAnswerFitMask(guessedAnswer, card.wordMask)) {
                setLlmGuessStatus(`LLM đoán [${guessedAnswer}] nhưng không khớp mask.`);
                pushLog('error', '🔴 LLM Guess Mask Mismatch', `Đáp án [${guessedAnswer}] không khớp mask [${card.wordMask || ''}], không tự gửi.`);
                setAnswerInput(guessedAnswer);
                return;
            }

            setAnswerInput(guessedAnswer);
            setLlmGuessStatus(`LLM đoán: ${guessedAnswer}${guess?.confidence !== undefined ? ` | confidence: ${guess.confidence}` : ''}`);

            pushLog('auth', '✅ LLM Guess OK', `Card ID [${cardId}] -> đoán [${guessedAnswer}]${guess?.reason ? ` | ${guess.reason}` : ''}`);

            // Gửi ngay sau khi LLM trả kết quả và đã đổ đáp án lên input.
            // Dùng setTimeout 0 để React kịp render giá trị input trước, sau đó mới bắn socket.
            setTimeout(() => {
                sendAutoAnswerOnce(guessedAnswer, 'LLM', cardId, roundKey);
            }, 0);
        } catch (err: any) {
            const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message;
            const errorHint = err.response?.data?.hint ? ` | hint=${JSON.stringify(err.response.data.hint)}` : '';

            setLlmGuessStatus(`Lỗi gọi API LLM Guess: ${errorMessage}`);
            pushLog('error', '🔴 LLM Guess Error', `${errorMessage}${errorHint}`);
        }
    };

    const startRoundTimer = () => {
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        setTimeLeft(30);
        setTimerMessage('⏱️ Còn lại: 30 giây');
        timerIntervalRef.current = setInterval(() => {
            setTimeLeft((prev) => {
                if (prev <= 1) {
                    clearInterval(timerIntervalRef.current!);
                    return 0;
                }
                setTimerMessage(`⏱️ Còn lại: ${prev - 1} giây`);
                return prev - 1;
            });
        }, 1000);
    };

    const stopRoundTimer = (msg: string) => {
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        clearPendingAutoAnswer();
        activeRoundKeyRef.current = '';
        setTimerMessage(msg);
        setTimeLeft(0);
    };

    const getPayloadString = (value: any) => (typeof value === 'string' ? value.trim() : '');

    const getNestedValue = (payload: any, paths: string[]) => {
        for (const path of paths) {
            const value = path.split('.').reduce<any>((acc, key) => acc?.[key], payload);
            if (value !== undefined && value !== null && String(value).trim()) return value;
        }

        return '';
    };

    const getMessageTextFromPayload = (payload: any) => {
        if (typeof payload === 'string') return payload.trim();

        const directText = getNestedValue(payload, [
            'message',
            'text',
            'content',
            'body',
            'answer',
            'data.message',
            'data.text',
            'data.content',
            'data.answer',
            'chat.message',
            'chat.text',
            'payload.message',
            'payload.text',
            'payload.answer',
        ]);

        if (typeof directText === 'string') return directText.trim();

        if (directText && typeof directText === 'object') {
            const nestedText = getNestedValue(directText, ['message', 'text', 'content', 'body', 'answer']);
            return getPayloadString(nestedText);
        }

        return '';
    };

    const getSenderFromPayload = (payload: any) => {
        const senderObj =
            payload?.sender || payload?.from || payload?.user || payload?.player || payload?.author || payload?.data?.sender || payload?.data?.from;

        const userId = String(
            getNestedValue(payload, [
                'senderId',
                'userId',
                'uid',
                'fromUserId',
                'fromId',
                'authorId',
                'data.senderId',
                'data.userId',
                'data.uid',
                'data.fromUserId',
                'sender.userId',
                'sender.uid',
                'from.userId',
                'from.uid',
                'user.userId',
                'user.uid',
                'player.userId',
                'player.uid',
                'author.userId',
                'author.uid',
            ]) ||
                senderObj?.userId ||
                senderObj?.uid ||
                '',
        ).trim();

        const displayName = String(
            getNestedValue(payload, [
                'displayName',
                'name',
                'username',
                'sender.displayName',
                'sender.name',
                'from.displayName',
                'from.name',
                'user.displayName',
                'user.name',
                'player.displayName',
                'player.name',
                'author.displayName',
                'author.name',
                'data.displayName',
                'data.sender.displayName',
                'data.from.displayName',
            ]) ||
                senderObj?.displayName ||
                senderObj?.name ||
                '',
        ).trim();

        return { userId, displayName };
    };

    const collectOpponentMessageIfNeeded = (eventName: string, eventData: any) => {
        const lowerEventName = eventName.toLowerCase();
        const isOpponentAnswerEvent = lowerEventName.includes('opponent-answer');
        const looksLikeMessageEvent = lowerEventName.includes('message') || lowerEventName.includes('chat') || isOpponentAnswerEvent;

        if (!looksLikeMessageEvent) return;

        const rawText = getMessageTextFromPayload(eventData);
        if (!rawText) return;

        const text = isOpponentAnswerEvent
            ? `Đáp án: ${rawText}${typeof eventData?.correct === 'boolean' ? (eventData.correct ? ' ✅ Đúng' : ' ❌ Sai') : ''}`
            : rawText;

        const opponentId = opponentRef.current?.userId?.trim();
        const currentUserId = userInfoRef.current.userId?.trim();
        const sender = getSenderFromPayload(eventData);
        const senderId = sender.userId?.trim();

        const isFromKnownOpponent = Boolean(opponentId && senderId && senderId === opponentId);
        const isProbablyOpponent = Boolean(opponentId && !senderId && (lowerEventName.includes('opponent') || lowerEventName.includes('enemy')));
        const isNotMeAndOpponentUnknown = Boolean(!opponentId && senderId && senderId !== currentUserId);

        if (!isFromKnownOpponent && !isProbablyOpponent && !isNotMeAndOpponentUnknown) return;

        const time = new Date().toLocaleTimeString('vi-VN', { hour12: false } as any);
        const message: OpponentMessage = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            eventName,
            userId: senderId || opponentId,
            displayName: sender.displayName || opponentRef.current?.displayName || 'Đối thủ',
            text,
            time,
            raw: eventData,
        };

        setOpponentMessages((prev) => [message, ...prev].slice(0, 50));

        if (!isOpponentMessagesOpen) {
            pushLog('auth', '💬 Tin nhắn đối thủ', `${message.displayName}: ${text}`);
        }
    };

    const clearHintAudio = () => {
        if (hintAudioRef.current) {
            hintAudioRef.current.pause();
            hintAudioRef.current.currentTime = 0;
            hintAudioRef.current = null;
        }

        setHintAudioUrl('');
        setHintPhoneticText('');
    };

    const handleHintAudio = (eventData: any) => {
        const phonetics = Array.isArray(eventData?.phonetics) ? eventData.phonetics : [];
        const audioHint = phonetics.find((item: any) => String(item?.audio || '').trim());

        if (!audioHint?.audio) {
            clearHintAudio();
            pushLog('auth', '🔇 Hint', 'Server gửi hint nhưng không có audio hợp lệ.');
            return;
        }

        const audioUrl = String(audioHint.audio).trim();
        const phoneticText = String(audioHint.text || '').trim();

        setHintAudioUrl(audioUrl);
        setHintPhoneticText(phoneticText);

        if (hintAudioRef.current) {
            hintAudioRef.current.pause();
            hintAudioRef.current = null;
        }

        hintAudioRef.current = new Audio(audioUrl);
        hintAudioRef.current.preload = 'auto';

        pushLog('auth', '🔊 Hint audio', `Đã nhận audio hint${phoneticText ? ` ${phoneticText}` : ''}.`);
    };

    const playHintAudio = async () => {
        if (!hintAudioUrl) return;

        try {
            const audio = hintAudioRef.current || new Audio(hintAudioUrl);
            hintAudioRef.current = audio;
            audio.currentTime = 0;
            await audio.play();
            pushLog('auth', '🔊 Nghe hint', hintPhoneticText || hintAudioUrl);
        } catch (err: any) {
            pushLog('error', '🔴 Lỗi phát hint', err?.message || 'Trình duyệt chặn phát audio.');
            showBattleToast('error', 'Không phát được audio', 'Trình duyệt có thể đang chặn audio. Hãy bấm lại nút Nghe.');
        }
    };

    const handleIncomingGameEvent = (eventName: string, eventData: any) => {
        pushLog('in', `📨 ${eventName}`, eventData);
        collectOpponentMessageIfNeeded(eventName, eventData);
        switch (eventName) {
            case 'vocab-battle:game-start':
                setIsInBattle(true);
                setIsSearchingBattle(false);
                setIsCreateRoomPanelOpen(false);
                setIsJoinRoomPanelOpen(false);
                setCanRematch(false);
                showBattleToast('success', 'Đã vào trận', 'Trận đấu đã bắt đầu. Hệ thống đang theo dõi round hiện tại.');
                setMyCorrectCount(0);
                setOpponentCorrectCount(0);
                const matchedOpponent = eventData?.opponent || null;
                setOpponent(matchedOpponent);
                setIsOpponentMessagesOpen(false);
                setOpponentMessages([]);
                opponentRef.current = matchedOpponent;
                resetOpponentBattleActivity();

                if (matchedOpponent?.userId) {
                    setTimeout(() => {
                        if (opponentRef.current?.userId === matchedOpponent.userId) {
                            loadOpponentBattleActivity(matchedOpponent, 'game-start');
                        }
                    }, 150);
                }

                if (handleAutoOutMatchedOpponent(matchedOpponent)) {
                    break;
                }

                if (Array.isArray(eventData?.players)) {
                    const me = eventData.players.find((p: any) => p.userId === userInfoRef.current.userId);
                    if (me && me.diamonds !== undefined) setMyDiamonds(me.diamonds);
                }
                break;
            case 'vocab-battle:round-start':
                setCanRematch(false);
                setMissingCardId(null);
                setLlmGuessStatus('');
                clearPendingAutoAnswer();
                answerSentRef.current = false;
                clearHintAudio();
                startRoundTimer();
                const round = eventData?.round || 0;
                const totalRounds = eventData?.totalRounds || 0;
                const card = eventData?.card;
                if (card) {
                    const cardId = String(card.cardId || '').trim();
                    const roundKey = `${cardId}:${round}:${Date.now()}`;
                    activeRoundKeyRef.current = roundKey;
                    currentCardIdRef.current = cardId;
                    currentCardPayloadRef.current = card;
                    currentRoundMetaRef.current = { round, totalRounds };
                    setRoundText(`Round: ${round} / ${totalRounds}`);
                    setWordMask(`${card.wordMask || ''} (${card.wordLength || 0} ký tự)`);
                    setWordMeaning(card.translation?.vi || 'Không có dịch nghĩa');
                    setWordExample({ en: card.exampleMasked?.en || '...', vi: card.exampleMasked?.vi || '' });

                    // FIX CRITICAL: Tra cứu từ `serverCardMapRef.current` chạy thời gian thực thay cho useMemo
                    const targetWord = serverCardMapRef.current.get(cardId) || '';
                    if (targetWord) {
                        setAnswerInput(targetWord);
                        triggerAutoSolver(targetWord, cardId, roundKey);
                    } else {
                        setMissingCardId(cardId);
                        setAnswerInput('');

                        if (autoGuessRef.current) {
                            guessMissingCardWithLLM(eventData, roundKey);
                        } else {
                            setLlmGuessStatus('Auto Guess đang tắt. Không gọi LLM, bạn có thể nhập đáp án thủ công.');
                            pushLog('auth', '⏸️ Auto Guess OFF', `Không tìm thấy card_id [${cardId}], nhưng Auto Guess đang tắt nên không gọi /guess-word.`);
                        }
                    }
                }
                break;
            case 'vocab-battle:hint':
                handleHintAudio(eventData);
                break;
            case 'vocab-battle:round-result':
            case 'vocab-battle:round-timeout':
                const statusMsg = eventName.includes('timeout') ? 'Hết giờ round! ⏰' : 'Round kết thúc ✅';
                stopRoundTimer(statusMsg);
                setLlmGuessStatus('');

                const roundWord = eventData?.word;
                if (roundWord && currentCardIdRef.current) {
                    const cardId = currentCardIdRef.current;

                    // KIỂM TRA: Nếu card_id đã tồn tại trong Map đồng bộ (Ref) thì BỎ QUA hoàn toàn
                    if (serverCardMapRef.current.has(cardId)) {
                        pushLog('auth', '⏭️ Bỏ qua Sync', `Card ID [${cardId}] đã tồn tại sẵn trong database. Không thu thập lại.`);
                    } else {
                        // Chỉ cập nhật state, thêm vào list thu thập và sync API khi CHƯA TỒN TẠI
                        updateServerCardState(cardId, roundWord, null, 'new');

                        const nowStr = new Date().toLocaleTimeString('vi-VN', { hour12: false } as any);
                        setCollectedVocabs((prev) => [{ cardId: cardId, word: roundWord, time: nowStr }, ...prev]);

                        const currentCardForJson = currentCardPayloadRef.current || { cardId };
                        const currentRoundMeta = currentRoundMetaRef.current;

                        syncCardToCollectionJson({
                            card: currentCardForJson,
                            word: roundWord,
                            sourceEvent: eventName,
                            round: currentRoundMeta?.round,
                            totalRounds: currentRoundMeta?.totalRounds,
                        });

                        syncWordToApi(cardId, roundWord);
                    }
                }

                // --- Giữ nguyên logic cập nhật kim cương và kết quả điểm số bên dưới của bạn ---
                if (Array.isArray(eventData?.players)) {
                    const me = eventData.players.find((p: any) => p.userId === userInfoRef.current.userId);
                    if (me && me.diamonds !== undefined) {
                        setMyDiamonds(me.diamonds);
                    }
                    const op = eventData.players.find((p: any) => p.userId === opponentRef.current?.userId);
                    if (op && op.diamonds !== undefined) {
                        setOpponent((prev) => (prev ? { ...prev, diamonds: op.diamonds } : null));
                    }
                }

                const winnerId = eventData?.winnerId;
                const opId = opponentRef.current?.userId;
                if (winnerId && eventName === 'vocab-battle:round-result') {
                    if (winnerId === opId) setOpponentCorrectCount((p) => p + 1);
                    else setMyCorrectCount((p) => p + 1);
                }
                break;
            case 'vocab-battle:game-over':
                stopRoundTimer('Trận đấu kết thúc 🏁');
                setMissingCardId(null);
                setLlmGuessStatus('');
                answerSentRef.current = false;
                setIsInBattle(false);
                setIsSearchingBattle(false);
                setCanRematch(true);
                showBattleToast('info', 'Trận đấu kết thúc', 'Bạn có thể bấm Tái trận để gửi yêu cầu rematch.');
                const finalWinner = eventData?.winnerId;
                const finalOpId = opponentRef.current?.userId;

                if (Array.isArray(eventData?.players)) {
                    const me = eventData.players.find((p: any) => p.userId === userInfoRef.current.userId);
                    if (me && me.diamonds !== undefined) setMyDiamonds(me.diamonds);
                }

                setOpponent(null);
                resetOpponentBattleActivity();
                setIsOpponentMessagesOpen(false);
                opponentRef.current = null;
                currentCardIdRef.current = null;
                currentCardPayloadRef.current = null;
                currentRoundMetaRef.current = null;
                clearHintAudio();
                let winUpdate = matchStatsRef.current.wins;
                let lossUpdate = matchStatsRef.current.losses;
                if (finalWinner && finalWinner !== finalOpId) {
                    winUpdate++;
                    pushLog('auth', '🏆 Kết quả', '🎉 BẠN CHIẾN THẮNG TRẬN ĐẤU!');
                } else if (finalWinner === finalOpId) {
                    lossUpdate++;
                    pushLog('error', '🏆 Kết quả', '💀 BẠN THẤT BẠI TRẬN ĐẤU!');
                }
                const newMatchStats = { wins: winUpdate, losses: lossUpdate };
                setMatchStats(newMatchStats);
                matchStatsRef.current = newMatchStats;
                localStorage.setItem('paroto_match_stats', JSON.stringify(newMatchStats));

                // Sau game-over, gọi activity API để lấy ELO mới nhất của người chơi.
                setTimeout(() => {
                    loadBattleActivity('game-over');
                }, 700);

                if (pendingTokenRefreshAfterBattleRef.current) {
                    pendingTokenRefreshAfterBattleRef.current = false;
                    setTimeout(() => {
                        runTimedTokenRefresh('after-battle');
                    }, 1200);
                }

                const shouldAutoSyncAfterBattle = autoSyncAfterBattleRef.current;
                const shouldAutoRematch = autoRematchRef.current;
                const shouldAutoCreateRoom = autoCreateRoomRef.current;
                const shouldAutoJoinNextBattle = autoJoinRef.current;

                const runNextAutoAction = () => {
                    if (shouldAutoRematch) {
                        pushLog('auth', '🔁 Auto Rematch', 'Trận kết thúc -> tự động gửi yêu cầu tái trận sau 1 giây.');
                        setCanRematch(false);
                        setTimeout(() => emitRematch(), 1000);
                        return;
                    }

                    if (shouldAutoCreateRoom) {
                        pushLog('auth', '🟣 Auto Create Room', 'Trận kết thúc -> tự động tạo phòng mới bằng cấu hình đã lưu sau 1 giây.');
                        setCanRematch(false);
                        setTimeout(() => emitCreateBattleRoom('Auto Create Room'), 1000);
                        return;
                    }

                    if (shouldAutoJoinNextBattle) {
                        pushLog('auth', '🔄 Auto-Join', 'Hệ thống tự động tìm trận mới sau 2 giây...');
                        setCanRematch(false);
                        setTimeout(() => emitJoinBattle(), 2000);
                    }
                };

                if (shouldAutoRematch || shouldAutoCreateRoom || shouldAutoJoinNextBattle) {
                    setCanRematch(false);
                }

                if (shouldAutoSyncAfterBattle) {
                    pushLog('auth', '🔁 Auto Load Data', 'Trận kết thúc -> tự động đồng bộ lại danh sách từ server.');
                    loadCardsFromApi().then(runNextAutoAction);
                } else {
                    runNextAutoAction();
                }
                break;
            case 'error': {
                const errorMessage = String(eventData?.message || 'Có lỗi từ server.');
                setIsSearchingBattle(false);
                if (errorMessage.toLowerCase().includes('room not found')) {
                    setCanRematch(false);
                }
                showBattleToast('error', 'Lỗi', errorMessage);
                pushLog('error', '🔴 Server Error', errorMessage);
                break;
            }
        }
    };

    const triggerAutoSolver = (word: string, cardId?: string, roundKey?: string) => {
        const cleanWord = normalizeAnswer(word);
        if (!autoSendRef.current || !cleanWord) return;

        const len = cleanWord.length;
        let delay = 1000;

        if (len < 5) delay = Math.floor(Math.random() * 200) + 200;
        else if (len <= 8) delay = Math.floor(Math.random() * 400) + 3000;
        else if (len <= 12) delay = Math.floor(Math.random() * 400) + 5000;
        else delay = Math.floor(Math.random() * 500) + Math.floor(Math.random() * 8000);

        clearPendingAutoAnswer();
        pushLog('auth', '🤖 Auto-Solver', `Từ [${cleanWord}] (${len} ký tự) -> Tự gửi sau ${(delay / 1000).toFixed(2)}s`);

        autoAnswerTimeoutRef.current = setTimeout(() => {
            sendAutoAnswerOnce(cleanWord, 'Auto', cardId, roundKey);
        }, delay);
    };

    const handleTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        applyFirebaseToken(e.target.value, 'Manual Input');
    };

    const connectSocket = () => {
        if (socketRef.current?.readyState === WebSocket.OPEN || socketRef.current?.readyState === WebSocket.CONNECTING) return;
        manualDisconnectRef.current = false;
        setSocketStatus('connecting');
        const ws = new WebSocket(SOCKET_URL);
        socketRef.current = ws;

        ws.onopen = () => {
            setSocketStatus('connected');
            failedConnectionsRef.current = 0;
            const tokenToUse = firebaseTokenRef.current.trim();
            if (tokenToUse) {
                ws.send(`40${JSON.stringify({ firebaseToken: tokenToUse })}`);
                pushLog('auth', '🔑 Token Authenticated', `UID kết nối: ${userInfoRef.current.userId}`);
            } else {
                ws.send('40');
            }

            if (pendingAutoJoinAfterReconnectRef.current) {
                pendingAutoJoinAfterReconnectRef.current = false;
                pushLog('auth', '⚔️ Auto Find Match', 'Socket đã kết nối lại -> tự động tìm trận đầu tiên.');
                setTimeout(() => {
                    if (socketRef.current?.readyState === WebSocket.OPEN) {
                        emitJoinBattle();
                    }
                }, 800);
            } else if (autoCreateRoomRef.current) {
                pushLog('auth', '🟣 Auto Create Room', 'Socket đã kết nối -> tự động tạo phòng bằng cấu hình đã lưu.');
                setTimeout(() => {
                    if (autoCreateRoomRef.current && socketRef.current?.readyState === WebSocket.OPEN) {
                        emitCreateBattleRoom('Auto Create Room');
                    }
                }, 900);
            }
        };

        ws.onmessage = (event) => {
            const raw = event.data;
            if (typeof raw !== 'string') return;
            if (raw === '2') {
                ws.send('3');
                return;
            }
            if (raw === '3') return;
            if (raw.startsWith('42')) {
                try {
                    const parsed = JSON.parse(raw.substring(2));
                    handleIncomingGameEvent(parsed[0], parsed[1]);
                } catch {
                    /* ignore */
                }
            }
        };

        ws.onerror = () => {
            pushLog('error', '🔴 Socket Error', 'Socket gặp lỗi kết nối. Hệ thống sẽ xử lý refresh token ở bước onclose.');
        };

        ws.onclose = async (event) => {
            setSocketStatus('disconnected');
            setIsInBattle(false);
            setIsSearchingBattle(false);
            setCanRematch(false);
            stopRoundTimer('Mất kết nối Socket 🔴');

            if (manualDisconnectRef.current) {
                manualDisconnectRef.current = false;
                pendingAutoJoinAfterReconnectRef.current = false;
                return;
            }

            failedConnectionsRef.current += 1;
            pushLog(
                'error',
                '🔌 Socket Closed',
                `Socket bị ngắt/lỗi lần ${failedConnectionsRef.current}. Code=${event.code || 'N/A'}, reason=${event.reason || 'Không có'}`,
            );

            if (autoRefreshTokenRef.current) {
                pushLog('auth', '🔄 Socket lỗi -> Refresh Token', 'Đang tự động refresh token ngay sau khi socket mất kết nối.');
                const success = await handleRefreshFirebaseToken();

                if (!success) {
                    pendingAutoJoinAfterReconnectRef.current = false;
                    pushLog('error', '🛑 Dừng kết nối lại', 'Không thể tự động Refresh Token. Hãy kiểm tra API Key / Refresh Token.');
                    return;
                }

                pendingAutoJoinAfterReconnectRef.current = true;
                pushLog('auth', '🔁 Reconnect + Find Match', 'Refresh token thành công -> tự động kết nối lại socket và tìm trận đầu tiên.');
                setTimeout(() => {
                    if (socketRef.current?.readyState !== WebSocket.OPEN && socketRef.current?.readyState !== WebSocket.CONNECTING) {
                        connectSocket();
                    }
                }, 1000);
                return;
            }

            if (autoConnectRef.current) {
                pushLog('auth', '🔁 Auto Connect', 'Auto Refresh Token đang tắt -> chỉ thử kết nối lại sau 2 giây.');
                setTimeout(() => {
                    if (autoConnectRef.current && socketRef.current?.readyState !== WebSocket.OPEN) connectSocket();
                }, 2000);
            }
        };
    };

    const disconnectSocket = () => {
        if (socketRef.current) {
            manualDisconnectRef.current = true;
            failedConnectionsRef.current = 0;
            pendingAutoJoinAfterReconnectRef.current = false;
            setCanRematch(false);
            socketRef.current.close();
            pushLog('auth', '🔌 Disconnect', 'Chủ động ngắt kết nối socket.');
        }
    };

    const emitJoinBattle = () => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send('42["join-vocab-battle"]');
            setCanRematch(false);
            setIsSearchingBattle(true);
            pushLog('out', '⚔️ Tìm trận', '["join-vocab-battle"]');
        }
    };

    const emitRematch = () => {
        if (socketRef.current?.readyState !== WebSocket.OPEN) {
            showBattleToast('error', 'Không thể tái trận', 'Socket chưa kết nối. Hãy kết nối lại trước khi tái trận.');
            pushLog('error', '🔴 Rematch', 'Socket chưa kết nối, không gửi được vocab-battle-rematch.');
            return;
        }

        socketRef.current.send('42["vocab-battle-rematch"]');
        setCanRematch(false);
        setIsSearchingBattle(true);
        showBattleToast('info', 'Đã gửi tái trận', 'Đang chờ đối thủ hoặc server phản hồi.');
        pushLog('out', '🔁 Tái trận', '["vocab-battle-rematch"]');
    };

    const emitCreateBattleRoom = (source: 'Manual' | 'Auto Create Room' = 'Manual') => {
        const cleanPassword = createRoomPassword.trim();

        if (socketRef.current?.readyState !== WebSocket.OPEN) {
            showBattleToast('error', 'Không thể tạo phòng', 'Socket chưa kết nối. Hãy bấm Kết nối trước.');
            pushLog('error', '🔴 Create Room', 'Socket chưa kết nối, không gửi được create-vocab-battle-room.');
            return;
        }

        if (isInBattle || isSearchingBattle) {
            showBattleToast('info', 'Chưa thể tạo phòng', 'Đang trong trận hoặc đang chờ phản hồi, hệ thống sẽ bỏ qua lệnh tạo phòng lần này.');
            pushLog('auth', '⏭️ Create Room Skip', 'Đang trong trận hoặc đang tìm/chờ phòng, không gửi create-vocab-battle-room.');
            return;
        }

        const payload: { isPublic: boolean; password?: string } = {
            isPublic: createRoomIsPublic,
        };

        // password optional: chỉ gửi password khi người dùng có nhập
        if (cleanPassword) {
            payload.password = cleanPassword;
        }

        const eventPayload = ['create-vocab-battle-room', payload] as const;
        socketRef.current.send('42' + JSON.stringify(eventPayload));
        setCanRematch(false);
        setIsSearchingBattle(true);
        setIsCreateRoomPanelOpen(false);
        showBattleToast(
            'info',
            source === 'Auto Create Room' ? 'Auto tạo phòng' : 'Đã gửi tạo phòng',
            cleanPassword ? 'Đã tạo phòng riêng có mật khẩu, đang chờ server phản hồi.' : 'Đã tạo phòng không mật khẩu, đang chờ server phản hồi.',
        );
        pushLog('out', source === 'Auto Create Room' ? '🟣 Auto Create Room' : '🏠 Tạo phòng', JSON.stringify(eventPayload));
    };

    const emitJoinBattleRoom = () => {
        const cleanRoomId = battleRoomId.trim();
        const cleanPassword = battleRoomPassword.trim();

        if (!cleanRoomId) {
            pushLog('error', '🔴 Join Room', 'Thiếu roomId. Hãy nhập Room ID trước khi join phòng.');
            return;
        }

        if (socketRef.current?.readyState !== WebSocket.OPEN) {
            pushLog('error', '🔴 Join Room', 'Socket chưa kết nối. Hãy bấm Kết nối trước.');
            return;
        }

        const payload: { roomId: string; password?: string } = {
            roomId: cleanRoomId,
        };

        // password optional: chỉ gửi password khi người dùng có nhập
        if (cleanPassword) {
            payload.password = cleanPassword;
        }

        const eventPayload = ['join-vocab-battle-room', payload] as const;
        socketRef.current.send('42' + JSON.stringify(eventPayload));
        setCanRematch(false);
        setIsSearchingBattle(true);
        setIsJoinRoomPanelOpen(false);
        pushLog('out', '🏠 Join Room', JSON.stringify(eventPayload));
    };

    const sendManualAnswer = () => {
        const cleanAnswer = normalizeAnswer(answerInput);
        if (!cleanAnswer || socketRef.current?.readyState !== WebSocket.OPEN) return;

        answerSentRef.current = true;
        clearPendingAutoAnswer();

        socketRef.current.send('42' + JSON.stringify(['vocab-battle-answer', { answer: cleanAnswer }]));
        pushLog('out', '🎯 Gửi đáp án (Manual)', `["vocab-battle-answer", {"answer":"${cleanAnswer}"}]`);
        setAnswerInput('');
    };

    const filteredServerCards = useMemo(() => {
        if (!serverSearch.trim()) return serverCards;
        const keyword = serverSearch.toLowerCase();
        return serverCards.filter((c) => c.card_id.toLowerCase().includes(keyword) || c.word.toLowerCase().includes(keyword));
    }, [serverCards, serverSearch]);

    const loadBotQueueStatus = async (silent = false) => {
        if (!silent) setIsLoadingBotQueue(true);

        try {
            const res = await axios.get(`${API_BASE_URL}/bot-queue/status`, { timeout: 8000 });
            const normalized = normalizeBotQueueResponse(res.data);
            setBotQueueStatus(normalized);

            if (!silent) {
                pushLog('auth', '🤖 Bot Queue Status', `Đã tải trạng thái ${normalized.bots.length} bot từ Go server.`);
            }
        } catch (err: any) {
            if (!silent) {
                pushLog('error', '🔴 Bot Queue Status Error', err.response?.data?.message || err.message);
            }
        } finally {
            if (!silent) setIsLoadingBotQueue(false);
        }
    };

    const startBotQueue = async () => {
        if (!botQueueInputBots.length) {
            pushLog('error', '🔴 Bot Queue', 'Danh sách bot đang trống. Mỗi dòng cần là 1 Firebase Token hoặc botId|FirebaseToken.');
            return;
        }

        const invalidBots = botQueueInputBots.filter((bot) => bot.userId === DEFAULT_USER_INFO.userId);
        if (invalidBots.length > 0) {
            pushLog('error', '🔴 Bot Queue', `Có ${invalidBots.length} bot không decode được UID. Kiểm tra lại Firebase Token.`);
            return;
        }

        setIsStartingBotQueue(true);

        try {
            const delayAfterGameStartMs = Math.max(0, Number(botQueueDelayMs) || 1000);
            localStorage.setItem('paroto_bot_queue_list', botQueueText);
            localStorage.setItem('paroto_bot_queue_delay_ms', String(delayAfterGameStartMs));

            const payload = {
                delayAfterGameStartMs,
                bots: botQueueInputBots.map((bot) => ({
                    botId: bot.botId,
                    firebaseToken: bot.firebaseToken,
                })),
            };

            const res = await axios.post(`${API_BASE_URL}/bot-queue/start`, payload, { timeout: 12000 });
            const normalized = normalizeBotQueueResponse(res.data);
            setBotQueueStatus(normalized);
            pushLog('auth', '▶️ Bot Queue Start', `Đã gửi ${botQueueInputBots.length} bot lên Go server. Delay=${delayAfterGameStartMs}ms.`);

            await loadBotQueueStatus(true);
        } catch (err: any) {
            pushLog('error', '🔴 Bot Queue Start Error', err.response?.data?.message || err.message);
        } finally {
            setIsStartingBotQueue(false);
        }
    };

    const stopBotQueue = async () => {
        setIsStoppingBotQueue(true);

        try {
            const res = await axios.post(`${API_BASE_URL}/bot-queue/stop`, {}, { timeout: 8000 });
            const normalized = normalizeBotQueueResponse(res.data);
            setBotQueueStatus(normalized);
            pushLog('auth', '⏹️ Bot Queue Stop', 'Đã gửi lệnh dừng hàng chờ bot tới Go server.');
            await loadBotQueueStatus(true);
        } catch (err: any) {
            pushLog('error', '🔴 Bot Queue Stop Error', err.response?.data?.message || err.message);
        } finally {
            setIsStoppingBotQueue(false);
        }
    };

    const getBotQueueRowInfo = (bot: BotQueueServerBot) => {
        const botId = bot.botId || bot.bot_id || '--';
        const inputBot = botQueueInputBots.find((item) => item.botId === botId);

        return {
            botId,
            userId: bot.userId || bot.user_id || inputBot?.userId || '--',
            email: bot.email || inputBot?.email || '--',
            status: bot.status || 'unknown',
            lastEvent: bot.lastEvent || bot.last_event || bot.message || '--',
            retryCount: bot.retryCount ?? bot.retry_count ?? 0,
            updatedAt: bot.updatedAt || bot.updated_at || bot.startedAt || bot.started_at || '--',
        };
    };

    const exportCollectedJson = () => {
        if (!collectedVocabs.length) return;
        const blob = new Blob([JSON.stringify(collectedVocabs, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `paroto_collected_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
    };

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-6 selection:bg-sky-200">
            <div className="mx-auto max-w-7xl space-y-5">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                    <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200 shadow-sm">
                            <Zap className="h-5 w-5 text-sky-500" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight text-slate-800 md:text-2xl">Paroto Monitor & Solver</h1>
                            <p className="text-xs text-slate-500">WebSocket battle client</p>
                        </div>
                    </div>
                    <Badge variant="outline" className="hidden border-slate-200 bg-white font-mono text-xs text-slate-500 sm:inline-flex">
                        v2026.Next
                    </Badge>
                </div>

                <AnimatePresence>
                    {battleToast && (
                        <motion.div
                            key={battleToast.id}
                            initial={{ opacity: 0, y: -18, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -18, scale: 0.98 }}
                            className={`fixed right-4 top-4 z-[60] w-[calc(100vw-2rem)] max-w-sm rounded-2xl border bg-white p-4 shadow-2xl ${
                                battleToast.type === 'error'
                                    ? 'border-rose-200 shadow-rose-100'
                                    : battleToast.type === 'success'
                                      ? 'border-emerald-200 shadow-emerald-100'
                                      : 'border-sky-200 shadow-sky-100'
                            }`}
                        >
                            <div className="flex items-start gap-3">
                                <div
                                    className={`mt-0.5 rounded-xl p-2 ${
                                        battleToast.type === 'error'
                                            ? 'bg-rose-50 text-rose-600'
                                            : battleToast.type === 'success'
                                              ? 'bg-emerald-50 text-emerald-600'
                                              : 'bg-sky-50 text-sky-600'
                                    }`}
                                >
                                    {battleToast.type === 'error' ? (
                                        <AlertTriangle className="h-4 w-4" />
                                    ) : battleToast.type === 'success' ? (
                                        <CheckCircle2 className="h-4 w-4" />
                                    ) : (
                                        <RefreshCw className="h-4 w-4" />
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-bold text-slate-800">{battleToast.title}</div>
                                    <div className="mt-0.5 break-words text-xs leading-relaxed text-slate-500">{battleToast.message}</div>
                                </div>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setBattleToast(null)}>
                                    <X className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <AnimatePresence>
                    {isAutoPanelOpen && (
                        <motion.div
                            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsAutoPanelOpen(false)}
                        >
                            <motion.div
                                className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
                                initial={{ opacity: 0, scale: 0.96, y: 16 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.96, y: 16 }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-sky-50 px-5 py-4">
                                    <div>
                                        <h2 className="text-base font-bold text-slate-800">Cấu hình Auto</h2>
                                        <p className="text-xs text-slate-500">Bật/tắt các chế độ tự động trong một popup.</p>
                                    </div>
                                    <Button variant="ghost" size="sm" onClick={() => setIsAutoPanelOpen(false)}>
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>

                                <div className="space-y-3 p-5">
                                    <label className="flex cursor-pointer items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
                                        <div>
                                            <div className="text-sm font-bold text-emerald-700">Tự động kết nối</div>
                                            <div className="text-xs text-slate-500">Tự kết nối lại socket khi mở màn hình.</div>
                                        </div>
                                        <Checkbox
                                            checked={autoConnect}
                                            onCheckedChange={(c) => handleSetAutoConnect(!!c)}
                                            className="border-emerald-300 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500"
                                        />
                                    </label>

                                    <label className="flex cursor-pointer items-center justify-between rounded-xl border border-amber-100 bg-amber-50/50 p-3">
                                        <div>
                                            <div className="text-sm font-bold text-amber-700">Auto Refresh Token</div>
                                            <div className="text-xs text-slate-500">Khi socket lỗi, tự refresh token rồi kết nối lại.</div>
                                        </div>
                                        <Checkbox
                                            checked={autoRefreshToken}
                                            onCheckedChange={(c) => handleSetAutoRefreshToken(!!c)}
                                            className="border-amber-300 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
                                        />
                                    </label>

                                    <label className="flex cursor-pointer items-center justify-between rounded-xl border border-blue-100 bg-blue-50/50 p-3">
                                        <div>
                                            <div className="text-sm font-bold text-blue-700">Auto Refresh 30 phút</div>
                                            <div className="text-xs text-slate-500">
                                                Tự refresh_token sau mỗi 30 phút. Nếu đang trong trận sẽ chờ game-over rồi mới refresh.
                                            </div>
                                            <div className="mt-1 text-[11px] font-medium text-blue-600">{scheduledRefreshStatus}</div>
                                        </div>
                                        <Checkbox
                                            checked={autoTimedRefreshToken}
                                            onCheckedChange={(c) => handleSetAutoTimedRefreshToken(!!c)}
                                            className="border-blue-300 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
                                        />
                                    </label>

                                    <label className="flex cursor-pointer items-center justify-between rounded-xl border border-amber-100 bg-amber-50/50 p-3">
                                        <div>
                                            <div className="text-sm font-bold text-amber-700">Auto Check-in</div>
                                            <div className="text-xs text-slate-500">
                                                Tự điểm danh mỗi ngày một lần. Nếu hôm nay đã check-in thì không gọi API nữa.
                                            </div>
                                        </div>
                                        <Checkbox
                                            checked={autoCheckIn}
                                            onCheckedChange={(c) => handleSetAutoCheckIn(!!c)}
                                            className="border-amber-300 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
                                        />
                                    </label>

                                    <label className="flex cursor-pointer items-center justify-between rounded-xl border border-emerald-100 bg-white p-3">
                                        <div>
                                            <div className="text-sm font-bold text-emerald-700">Auto Answer</div>
                                            <div className="text-xs text-slate-500">Tự gửi đáp án đã có hoặc đáp án LLM đã đoán.</div>
                                        </div>
                                        <Checkbox
                                            checked={autoSend}
                                            onCheckedChange={(c) => handleSetAutoSend(!!c)}
                                            className="border-emerald-300 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500"
                                        />
                                    </label>

                                    <label className="flex cursor-pointer items-center justify-between rounded-xl border border-fuchsia-100 bg-white p-3">
                                        <div>
                                            <div className="text-sm font-bold text-fuchsia-700">Auto Guess</div>
                                            <div className="text-xs text-slate-500">Khi không tìm thấy card_id, tự gọi LLM để đoán từ.</div>
                                        </div>
                                        <Checkbox
                                            checked={autoGuess}
                                            onCheckedChange={(c) => handleSetAutoGuess(!!c)}
                                            className="border-fuchsia-300 data-[state=checked]:bg-fuchsia-500 data-[state=checked]:border-fuchsia-500"
                                        />
                                    </label>

                                    <label className="flex cursor-pointer items-center justify-between rounded-xl border border-violet-100 bg-white p-3">
                                        <div>
                                            <div className="text-sm font-bold text-violet-700">Tự tìm trận sau khi kết thúc</div>
                                            <div className="text-xs text-slate-500">Kết thúc trận sẽ tự tìm trận mới nếu đang bật.</div>
                                        </div>
                                        <Checkbox
                                            checked={autoJoin}
                                            onCheckedChange={(c) => handleSetAutoJoin(!!c)}
                                            className="border-violet-300 data-[state=checked]:bg-violet-500 data-[state=checked]:border-violet-500"
                                        />
                                    </label>

                                    <label className="flex cursor-pointer items-center justify-between rounded-xl border border-indigo-100 bg-white p-3">
                                        <div>
                                            <div className="text-sm font-bold text-indigo-700">Auto tạo phòng</div>
                                            <div className="text-xs text-slate-500">Dùng cấu hình đã lưu trong popup Tạo phòng để tự tạo phòng mới.</div>
                                        </div>
                                        <Checkbox
                                            checked={autoCreateRoom}
                                            onCheckedChange={(c) => handleSetAutoCreateRoom(!!c)}
                                            className="border-indigo-300 data-[state=checked]:bg-indigo-500 data-[state=checked]:border-indigo-500"
                                        />
                                    </label>

                                    <label className="flex cursor-pointer items-center justify-between rounded-xl border border-emerald-100 bg-white p-3">
                                        <div>
                                            <div className="text-sm font-bold text-emerald-700">Auto tái đấu</div>
                                            <div className="text-xs text-slate-500">Khi trận kết thúc, tự gửi event vocab-battle-rematch.</div>
                                        </div>
                                        <Checkbox
                                            checked={autoRematch}
                                            onCheckedChange={(c) => handleSetAutoRematch(!!c)}
                                            className="border-emerald-300 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500"
                                        />
                                    </label>

                                    <label className="flex cursor-pointer items-center justify-between rounded-xl border border-sky-100 bg-white p-3">
                                        <div>
                                            <div className="text-sm font-bold text-sky-700">Auto sync data</div>
                                            <div className="text-xs text-slate-500">Kết thúc trận sẽ tự đồng bộ lại danh sách từ server.</div>
                                        </div>
                                        <Checkbox
                                            checked={autoSyncAfterBattle}
                                            onCheckedChange={(c) => handleSetAutoSyncAfterBattle(!!c)}
                                            className="border-sky-300 data-[state=checked]:bg-sky-500 data-[state=checked]:border-sky-500"
                                        />
                                    </label>
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
                                    <Button size="sm" className="bg-indigo-600 text-white hover:bg-indigo-700" onClick={() => setIsAutoPanelOpen(false)}>
                                        Xong
                                    </Button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <AnimatePresence>
                    {isCreateRoomPanelOpen && (
                        <motion.div
                            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsCreateRoomPanelOpen(false)}
                        >
                            <motion.div
                                className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
                                initial={{ opacity: 0, scale: 0.96, y: 16 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.96, y: 16 }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-violet-50 to-indigo-50 px-5 py-4">
                                    <div>
                                        <h2 className="text-base font-bold text-slate-800">Tạo phòng đấu</h2>
                                        <p className="text-xs text-slate-500">Password có thể bỏ trống. Bật công khai nếu muốn tạo phòng public.</p>
                                    </div>
                                    <Button variant="ghost" size="sm" onClick={() => setIsCreateRoomPanelOpen(false)}>
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>

                                <div className="space-y-4 p-5">
                                    <label className="flex cursor-pointer items-center justify-between rounded-xl border border-violet-100 bg-violet-50/50 p-3">
                                        <div>
                                            <div className="text-sm font-bold text-violet-700">Phòng công khai</div>
                                            <div className="text-xs text-slate-500">Tắt để tạo phòng riêng theo payload isPublic=false.</div>
                                        </div>
                                        <Checkbox
                                            checked={createRoomIsPublic}
                                            onCheckedChange={(c) => {
                                                const value = !!c;
                                                setCreateRoomIsPublic(value);
                                                localStorage.setItem('paroto_create_room_is_public', String(value));
                                            }}
                                            className="border-violet-300 data-[state=checked]:bg-violet-500 data-[state=checked]:border-violet-500"
                                        />
                                    </label>

                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold uppercase tracking-wide text-violet-700">Password</label>
                                        <Input
                                            type="text"
                                            value={createRoomPassword}
                                            onChange={(e) => {
                                                setCreateRoomPassword(e.target.value);
                                                localStorage.setItem('paroto_create_room_password', e.target.value);
                                            }}
                                            placeholder="Không bắt buộc, ví dụ: 1234"
                                            className="h-10 border-violet-200 bg-white font-mono text-xs text-violet-700 placeholder:text-violet-300 focus:border-violet-400 focus:ring-violet-400/20"
                                        />
                                        <p className="text-[11px] text-slate-400">Bỏ trống password thì payload chỉ gửi isPublic.</p>
                                    </div>

                                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-500">
                                        Payload: ["create-vocab-battle-room",&#123;"isPublic":{String(createRoomIsPublic)}
                                        {createRoomPassword.trim() ? `,"password":"${createRoomPassword.trim()}"` : ''}&#125;]
                                    </div>

                                    {socketStatus !== 'connected' && (
                                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                                            Socket chưa kết nối. Hãy kết nối trước, sau đó bấm Tạo phòng.
                                        </div>
                                    )}
                                </div>

                                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
                                    <Button variant="outline" size="sm" className="bg-white" onClick={() => setIsCreateRoomPanelOpen(false)}>
                                        Hủy
                                    </Button>
                                    <Button
                                        size="sm"
                                        className="bg-violet-600 text-white hover:bg-violet-700"
                                        onClick={() => emitCreateBattleRoom()}
                                        disabled={socketStatus !== 'connected' || isInBattle || isSearchingBattle}
                                    >
                                        <Users className="mr-1.5 h-4 w-4" />
                                        {isSearchingBattle ? 'Đang tạo phòng...' : 'Tạo phòng'}
                                    </Button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <AnimatePresence>
                    {isJoinRoomPanelOpen && (
                        <motion.div
                            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsJoinRoomPanelOpen(false)}
                        >
                            <motion.div
                                className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
                                initial={{ opacity: 0, scale: 0.96, y: 16 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.96, y: 16 }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-sky-50 to-cyan-50 px-5 py-4">
                                    <div>
                                        <h2 className="text-base font-bold text-slate-800">Tham gia phòng</h2>
                                        <p className="text-xs text-slate-500">Nhập Room ID, password có thể bỏ trống nếu phòng không đặt mật khẩu.</p>
                                    </div>
                                    <Button variant="ghost" size="sm" onClick={() => setIsJoinRoomPanelOpen(false)}>
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>

                                <div className="space-y-4 p-5">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold uppercase tracking-wide text-sky-700">Room ID</label>
                                        <Input
                                            type="text"
                                            value={battleRoomId}
                                            onChange={(e) => {
                                                setBattleRoomId(e.target.value);
                                                localStorage.setItem('paroto_battle_room_id', e.target.value);
                                            }}
                                            placeholder="19c920d3-3512-49ad-a632-9b882d7278be"
                                            className="h-10 border-sky-200 bg-white font-mono text-xs text-sky-700 placeholder:text-sky-300 focus:border-sky-400 focus:ring-sky-400/20"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold uppercase tracking-wide text-sky-700">Password</label>
                                        <Input
                                            type="text"
                                            value={battleRoomPassword}
                                            onChange={(e) => {
                                                setBattleRoomPassword(e.target.value);
                                                localStorage.setItem('paroto_battle_room_password', e.target.value);
                                            }}
                                            placeholder="Không bắt buộc"
                                            className="h-10 border-sky-200 bg-white font-mono text-xs text-sky-700 placeholder:text-sky-300 focus:border-sky-400 focus:ring-sky-400/20"
                                        />
                                        <p className="text-[11px] text-slate-400">Bỏ trống password thì payload chỉ gửi roomId.</p>
                                    </div>

                                    {socketStatus !== 'connected' && (
                                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                                            Socket chưa kết nối. Hãy kết nối trước, sau đó bấm Tham gia phòng.
                                        </div>
                                    )}
                                </div>

                                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
                                    <Button variant="outline" size="sm" className="bg-white" onClick={() => setIsJoinRoomPanelOpen(false)}>
                                        Hủy
                                    </Button>
                                    <Button
                                        size="sm"
                                        className="bg-sky-600 text-white hover:bg-sky-700"
                                        onClick={emitJoinBattleRoom}
                                        disabled={socketStatus !== 'connected' || isInBattle || isSearchingBattle || !battleRoomId.trim()}
                                    >
                                        <Users className="mr-1.5 h-4 w-4" />
                                        {isSearchingBattle ? 'Đang tham gia...' : 'Tham gia phòng'}
                                    </Button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Connection & Auth Card */}
                <Card className="border-slate-200 bg-white shadow-sm">
                    <CardContent className="space-y-4 p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-2">
                                <span
                                    className={`h-2.5 w-2.5 rounded-full shadow-sm ${
                                        socketStatus === 'connected'
                                            ? 'bg-emerald-500 shadow-emerald-200'
                                            : socketStatus === 'connecting'
                                              ? 'bg-amber-500 shadow-amber-200 animate-pulse'
                                              : 'bg-rose-500 shadow-rose-200'
                                    }`}
                                />
                                <span className="text-sm font-semibold capitalize tracking-wide text-slate-700">{socketStatus}</span>
                                {isMounted && <span className="hidden font-mono text-xs text-slate-400 select-all lg:inline">{SOCKET_URL}</span>}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="border-indigo-200 bg-indigo-50 font-semibold text-indigo-700 hover:bg-indigo-100"
                                    onClick={() => setIsAutoPanelOpen(true)}
                                >
                                    <Zap className="mr-1.5 h-4 w-4" /> Auto
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                                    onClick={connectSocket}
                                    disabled={socketStatus !== 'disconnected'}
                                >
                                    <Activity className="mr-1.5 h-4 w-4 text-emerald-500" /> Kết nối
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                                    onClick={emitJoinBattle}
                                    disabled={socketStatus !== 'connected' || isInBattle || isSearchingBattle}
                                >
                                    <Shield className="mr-1.5 h-4 w-4 text-violet-500" />
                                    {isSearchingBattle ? 'Đang tìm trận...' : 'Tìm trận'}
                                </Button>
                                {canRematch && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="border-emerald-200 bg-emerald-50 font-semibold text-emerald-700 hover:bg-emerald-100"
                                        onClick={emitRematch}
                                        disabled={socketStatus !== 'connected' || isInBattle || isSearchingBattle}
                                    >
                                        <RotateCcw className={`mr-1.5 h-4 w-4 ${isSearchingBattle ? 'animate-spin' : ''}`} />
                                        Tái trận
                                    </Button>
                                )}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="border-violet-200 bg-violet-50 font-semibold text-violet-700 hover:bg-violet-100"
                                    onClick={() => setIsCreateRoomPanelOpen(true)}
                                    disabled={isInBattle || isSearchingBattle}
                                >
                                    <Users className="mr-1.5 h-4 w-4" />
                                    Tạo phòng
                                </Button>

                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="border-sky-200 bg-sky-50 font-semibold text-sky-700 hover:bg-sky-100"
                                    onClick={() => setIsJoinRoomPanelOpen(true)}
                                    disabled={isInBattle || isSearchingBattle}
                                >
                                    <Users className="mr-1.5 h-4 w-4" />
                                    Tham gia phòng
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                                    onClick={loadCardsFromApi}
                                    disabled={isLoadingServerCards}
                                >
                                    <RefreshCw className={`mr-1.5 h-4 w-4 text-sky-500 ${isLoadingServerCards ? 'animate-spin' : ''}`} />
                                    {isLoadingServerCards ? 'Đang load...' : 'Load data'}
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-amber-200 bg-white text-amber-700 hover:bg-amber-50"
                                    onClick={handleRefreshFirebaseToken}
                                    disabled={isRefreshing}
                                >
                                    <KeyRound className={`mr-1.5 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                                    Force Refresh Token
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className={
                                        checkInToday
                                            ? 'border-emerald-200 bg-emerald-50 font-semibold text-emerald-700 hover:bg-emerald-50'
                                            : 'border-amber-200 bg-amber-50 font-semibold text-amber-700 hover:bg-amber-100'
                                    }
                                    onClick={() => handleCheckIn(false)}
                                    disabled={isCheckingIn || checkInToday || !firebaseToken.trim()}
                                >
                                    {isCheckingIn ? (
                                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                    ) : checkInToday ? (
                                        <CheckCircle2 className="mr-1.5 h-4 w-4" />
                                    ) : (
                                        <Gem className="mr-1.5 h-4 w-4" />
                                    )}
                                    {isCheckingIn ? 'Đang check-in...' : checkInToday ? 'Đã check-in' : 'Check-in'}
                                </Button>

                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                                    onClick={disconnectSocket}
                                    disabled={socketStatus === 'disconnected'}
                                >
                                    <X className="mr-1.5 h-4 w-4 text-rose-500" /> Ngắt
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                                    onClick={() => {
                                        setEvents([]);
                                        setCollectedVocabs([]);
                                    }}
                                >
                                    <Trash2 className="mr-1.5 h-4 w-4" /> Xóa log
                                </Button>
                            </div>
                        </div>

                        {/* Inputs Block */}
                        <div className="grid gap-4 border-t border-slate-100 pt-4 md:grid-cols-4">
                            <div className="space-y-1">
                                <label className="font-mono text-xs font-semibold text-slate-500">Firebase Access Token:</label>
                                <Input
                                    type="text"
                                    value={firebaseToken}
                                    onChange={handleTokenChange}
                                    placeholder="Paste access_token (JWT)..."
                                    className="h-9 border-slate-200 bg-white font-mono text-xs placeholder:text-slate-400"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="font-mono text-xs font-semibold text-slate-500">Google API Key:</label>
                                <Input
                                    type="text"
                                    value={apiKey}
                                    onChange={(e) => {
                                        setApiKey(e.target.value);
                                        apiKeyRef.current = e.target.value;
                                        localStorage.setItem('paroto_api_key', e.target.value);
                                    }}
                                    placeholder="AIzaSyDy3B5322..."
                                    className="h-9 border-slate-200 bg-white font-mono text-xs placeholder:text-slate-400"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="font-mono text-xs font-semibold text-slate-500">Refresh Token:</label>
                                <Input
                                    type="text"
                                    value={refreshToken}
                                    onChange={(e) => {
                                        setRefreshToken(e.target.value);
                                        refreshTokenValueRef.current = e.target.value;
                                        localStorage.setItem('paroto_refresh_token', e.target.value);
                                    }}
                                    placeholder="AMf-vBz9PMLTHiakB..."
                                    className="h-9 border-slate-200 bg-white font-mono text-xs placeholder:text-slate-400"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="font-mono text-xs font-semibold text-rose-500">UID tự động out:</label>
                                <Input
                                    type="text"
                                    value={avoidUserIds}
                                    onChange={handleAvoidUserIdsChange}
                                    placeholder="Nhập UID cần né..."
                                    className="h-9 border-rose-200 bg-white font-mono text-xs text-rose-700 placeholder:text-rose-300 focus:border-rose-400 focus:ring-rose-400/20"
                                />
                                <p className="text-[10px] text-slate-400">Có thể nhập nhiều UID, cách nhau bằng dấu phẩy hoặc khoảng trắng.</p>
                            </div>
                        </div>

                        {/* Auth Info Status & Configurations */}
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-xs font-mono text-slate-500">
                            <div className="flex flex-wrap items-center gap-3">
                                <span>
                                    UID: <span className="font-bold text-sky-600">{userInfo.userId}</span>
                                </span>
                                <span>
                                    Email: <span className="font-bold text-sky-600">{userInfo.email}</span>
                                </span>
                                <span
                                    className={
                                        checkInToday
                                            ? 'rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1 font-bold text-emerald-600'
                                            : 'rounded-md border border-amber-100 bg-amber-50 px-2 py-1 font-bold text-amber-600'
                                    }
                                >
                                    {checkInStatusText}
                                </span>
                                {battleRoomId.trim() && (
                                    <span className="rounded-md border border-sky-100 bg-white px-2 py-1 text-sky-600">
                                        Room: <b>{battleRoomId}</b>
                                    </span>
                                )}
                                {(createRoomPassword.trim() || createRoomIsPublic) && (
                                    <span className="rounded-md border border-violet-100 bg-violet-50 px-2 py-1 text-violet-600">
                                        Create Room: <b>{createRoomIsPublic ? 'Public' : 'Private'}</b>
                                        {createRoomPassword.trim() ? ' • Có mật khẩu' : ' • Không mật khẩu'}
                                    </span>
                                )}
                                {avoidUserIds.trim() && (
                                    <span className="rounded-md border border-rose-100 bg-rose-50 px-2 py-1 font-bold text-rose-500">
                                        Auto out UID: {avoidUserIds}
                                    </span>
                                )}
                                {failedConnectionsRef.current > 0 && (
                                    <span className="rounded-md border border-rose-100 bg-white px-2 py-1 text-rose-500 font-bold">
                                        Lỗi socket: {failedConnectionsRef.current} lần
                                    </span>
                                )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <Badge
                                    variant="outline"
                                    className={autoConnect ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500'}
                                >
                                    Auto Connect: {autoConnect ? 'ON' : 'OFF'}
                                </Badge>
                                <Badge
                                    variant="outline"
                                    className={autoSend ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500'}
                                >
                                    Auto Answer: {autoSend ? 'ON' : 'OFF'}
                                </Badge>
                                <Badge
                                    variant="outline"
                                    className={autoGuess ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700' : 'border-slate-200 bg-white text-slate-500'}
                                >
                                    Auto Guess: {autoGuess ? 'ON' : 'OFF'}
                                </Badge>
                                <Badge
                                    variant="outline"
                                    className={autoJoin ? 'border-violet-200 bg-violet-50 text-violet-700' : 'border-slate-200 bg-white text-slate-500'}
                                >
                                    Auto Join: {autoJoin ? 'ON' : 'OFF'}
                                </Badge>
                                <Badge
                                    variant="outline"
                                    className={autoCreateRoom ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-500'}
                                >
                                    Auto Create Room: {autoCreateRoom ? 'ON' : 'OFF'}
                                </Badge>
                                <Badge
                                    variant="outline"
                                    className={autoRematch ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500'}
                                >
                                    Auto Rematch: {autoRematch ? 'ON' : 'OFF'}
                                </Badge>
                                <Badge
                                    variant="outline"
                                    className={
                                        checkInToday ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'
                                    }
                                >
                                    Check-in: {checkInToday ? 'DONE' : 'PENDING'}
                                </Badge>
                                <Badge
                                    variant="outline"
                                    className={autoTimedRefreshToken ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-500'}
                                    title={scheduledRefreshStatus}
                                >
                                    Refresh 30p: {autoTimedRefreshToken ? (pendingTokenRefreshAfterBattleRef.current ? 'PENDING' : 'ON') : 'OFF'}
                                </Badge>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Bot Queue Manager UI tạm thời ẩn, chưa xóa code. */}
                {false && (
                    <Card className="border-slate-200 bg-white shadow-sm">
                        <CardHeader className="border-b border-slate-100 pb-3">
                            <CardTitle className="flex items-center justify-between gap-3 text-sm font-bold text-slate-700">
                                <span className="flex items-center gap-2">
                                    <Bot className="h-4 w-4 text-sky-500" /> Bot Queue Manager
                                </span>
                                <Badge
                                    variant="outline"
                                    className={`font-mono text-[11px] ${botQueueStatus?.running ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500'}`}
                                >
                                    {botQueueStatus?.running ? 'RUNNING' : 'IDLE'}
                                </Badge>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 p-5">
                            <div className="grid gap-4 lg:grid-cols-3">
                                <div className="space-y-2 lg:col-span-1">
                                    <label className="font-mono text-xs font-semibold text-slate-500">Danh sách bot:</label>
                                    <textarea
                                        value={botQueueText}
                                        onChange={(e) => {
                                            setBotQueueText(e.target.value);
                                            localStorage.setItem('paroto_bot_queue_list', e.target.value);
                                        }}
                                        placeholder={`Mỗi dòng là 1 bot.\nCách 1: FirebaseToken\nCách 2: bot_1|FirebaseToken`}
                                        className="min-h-[180px] w-full rounded-md border border-slate-200 bg-white p-3 font-mono text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                                    />
                                    <p className="text-[11px] leading-relaxed text-slate-400">
                                        Client chỉ gửi danh sách bot lên Go server. Server sẽ điều phối: bot trước vào trận thì bot sau mới được đưa vào hàng
                                        chờ.
                                    </p>
                                </div>

                                <div className="space-y-3 lg:col-span-2">
                                    <div className="grid gap-3 md:grid-cols-4">
                                        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-center">
                                            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Tổng bot</div>
                                            <div className="mt-1 text-xl font-bold text-slate-700">{botQueueSummary.total}</div>
                                        </div>
                                        <div className="rounded-lg border border-sky-100 bg-sky-50 p-3 text-center">
                                            <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-600">Đang tìm</div>
                                            <div className="mt-1 text-xl font-bold text-sky-700">{botQueueSummary.searching}</div>
                                        </div>
                                        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-center">
                                            <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">Trong trận</div>
                                            <div className="mt-1 text-xl font-bold text-emerald-700">{botQueueSummary.inBattle}</div>
                                        </div>
                                        <div className="rounded-lg border border-rose-100 bg-rose-50 p-3 text-center">
                                            <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-600">Lỗi</div>
                                            <div className="mt-1 text-xl font-bold text-rose-700">{botQueueSummary.error}</div>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3">
                                        <div className="flex items-center gap-2">
                                            <label className="whitespace-nowrap text-xs font-semibold text-slate-500">Delay sau game-start:</label>
                                            <Input
                                                type="number"
                                                min={0}
                                                value={botQueueDelayMs}
                                                onChange={(e) => {
                                                    setBotQueueDelayMs(e.target.value);
                                                    localStorage.setItem('paroto_bot_queue_delay_ms', e.target.value);
                                                }}
                                                className="h-8 w-28 border-slate-200 bg-white font-mono text-xs"
                                            />
                                            <span className="text-xs text-slate-400">ms</span>
                                        </div>

                                        <div className="flex items-center gap-1.5 border-l border-slate-200 pl-3">
                                            <Checkbox
                                                id="botQueueAutoRefresh"
                                                checked={botQueueAutoRefresh}
                                                onCheckedChange={(c) => handleSetBotQueueAutoRefresh(!!c)}
                                                className="border-slate-300 data-[state=checked]:bg-sky-500 data-[state=checked]:border-sky-500"
                                            />
                                            <label htmlFor="botQueueAutoRefresh" className="cursor-pointer select-none text-xs font-semibold text-sky-600">
                                                Tự refresh trạng thái
                                            </label>
                                        </div>

                                        <div className="ml-auto flex flex-wrap gap-2">
                                            <Button
                                                size="sm"
                                                className="bg-sky-500 text-white hover:bg-sky-600"
                                                onClick={startBotQueue}
                                                disabled={isStartingBotQueue || botQueueInputBots.length === 0}
                                            >
                                                <Play className="mr-1.5 h-3.5 w-3.5" />
                                                {isStartingBotQueue ? 'Đang start...' : 'Start Queue'}
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                                onClick={() => loadBotQueueStatus(false)}
                                                disabled={isLoadingBotQueue}
                                            >
                                                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isLoadingBotQueue ? 'animate-spin' : ''}`} />
                                                Status
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
                                                onClick={stopBotQueue}
                                                disabled={isStoppingBotQueue}
                                            >
                                                <Square className="mr-1.5 h-3.5 w-3.5" />
                                                {isStoppingBotQueue ? 'Đang dừng...' : 'Stop'}
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="max-h-[280px] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/40">
                                        <Table>
                                            <TableHeader className="sticky top-0 z-10 bg-white shadow-sm">
                                                <TableRow className="border-slate-200 hover:bg-transparent">
                                                    <TableHead className="w-[14%] text-xs font-semibold text-slate-600">Bot</TableHead>
                                                    <TableHead className="w-[20%] text-xs font-semibold text-slate-600">UID</TableHead>
                                                    <TableHead className="w-[22%] text-xs font-semibold text-slate-600">Email</TableHead>
                                                    <TableHead className="w-[16%] text-xs font-semibold text-slate-600">Trạng thái</TableHead>
                                                    <TableHead className="w-[20%] text-xs font-semibold text-slate-600">Event cuối</TableHead>
                                                    <TableHead className="w-[8%] text-xs font-semibold text-slate-600">Retry</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {botQueueDisplayRows.length === 0 ? (
                                                    <TableRow>
                                                        <TableCell colSpan={6} className="py-8 text-center text-xs text-slate-500">
                                                            <ListChecks className="mx-auto mb-2 h-7 w-7 text-slate-300" />
                                                            Chưa có bot nào. Dán danh sách bot ở ô bên trái rồi nhấn Start Queue.
                                                        </TableCell>
                                                    </TableRow>
                                                ) : (
                                                    botQueueDisplayRows.map((bot, idx) => {
                                                        const row = getBotQueueRowInfo(bot);
                                                        return (
                                                            <TableRow key={`${row.botId}-${idx}`} className="border-slate-100 font-mono text-xs hover:bg-white">
                                                                <TableCell className="font-bold text-slate-700">{row.botId}</TableCell>
                                                                <TableCell className="max-w-[180px] truncate text-slate-500" title={row.userId}>
                                                                    {row.userId}
                                                                </TableCell>
                                                                <TableCell className="max-w-[180px] truncate text-slate-500" title={row.email}>
                                                                    {row.email}
                                                                </TableCell>
                                                                <TableCell>
                                                                    <Badge
                                                                        variant="outline"
                                                                        className={`font-sans text-[11px] ${getBotQueueStatusClass(row.status)}`}
                                                                    >
                                                                        {getBotQueueStatusLabel(row.status)}
                                                                    </Badge>
                                                                </TableCell>
                                                                <TableCell className="max-w-[220px] truncate text-slate-500" title={row.lastEvent}>
                                                                    {row.lastEvent}
                                                                </TableCell>
                                                                <TableCell className="text-center text-slate-500">{row.retryCount}</TableCell>
                                                            </TableRow>
                                                        );
                                                    })
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-100 bg-white px-3 py-2 text-[11px] text-slate-500">
                                        <span>
                                            Active searching:{' '}
                                            <b className="font-mono text-sky-600">
                                                {botQueueStatus?.activeSearching || botQueueStatus?.active_searching || '--'}
                                            </b>
                                        </span>
                                        <span>
                                            Waiting: <b className="font-mono text-slate-700">{botQueueSummary.waiting}</b>
                                        </span>
                                        <span>
                                            Stopped: <b className="font-mono text-slate-700">{botQueueSummary.stopped}</b>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}

                <AnimatePresence>
                    {isInBattle && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="relative overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-sky-50 to-indigo-50 p-4 shadow-sm"
                        >
                            <motion.div
                                className="absolute -left-8 top-1/2 h-24 w-24 -translate-y-1/2 rounded-full bg-emerald-300/25 blur-2xl"
                                animate={{ scale: [1, 1.35, 1], opacity: [0.45, 0.8, 0.45] }}
                                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                            />
                            <div className="relative flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    <div className="rounded-xl bg-white/80 p-2 ring-1 ring-emerald-100">
                                        <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
                                    </div>
                                    <div>
                                        <div className="text-sm font-bold text-emerald-700">Đang trong trận</div>
                                        <div className="text-xs text-slate-500">Solver đang theo dõi round, timer và trạng thái gửi đáp án.</div>
                                    </div>
                                </div>
                                <Badge variant="outline" className="border-emerald-200 bg-white/80 font-mono text-emerald-700">
                                    LIVE • {roundText}
                                </Badge>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Main grid: Battle + Opponent */}
                <div className="grid gap-4 lg:grid-cols-3">
                    <div className="space-y-4 lg:col-span-2">
                        {/* Timer / Word Card */}
                        <Card
                            className={`overflow-hidden border-slate-200 bg-white shadow-sm ${isInBattle ? 'ring-2 ring-emerald-100 shadow-emerald-100' : ''}`}
                        >
                            <div className="relative h-1.5 bg-slate-100">
                                <motion.div
                                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-400 to-sky-400"
                                    animate={{ width: `${(timeLeft / 30) * 100}%` }}
                                    transition={{ duration: 1, ease: 'linear' }}
                                    style={{
                                        background: timeLeft <= 10 ? 'linear-gradient(90deg, #f43f5e, #f59e0b)' : undefined,
                                    }}
                                />
                            </div>
                            <CardContent className="space-y-4 p-5">
                                <div className="flex items-center justify-center rounded-lg bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                                    {timerMessage}
                                </div>

                                {canRematch && !isInBattle && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -5 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700"
                                    >
                                        <div>
                                            <div className="font-bold">Trận vừa kết thúc</div>
                                            <div className="text-emerald-600">Có thể gửi yêu cầu tái trận với đối thủ trước đó.</div>
                                        </div>
                                        <Button
                                            size="sm"
                                            className="bg-emerald-600 text-white hover:bg-emerald-700"
                                            onClick={emitRematch}
                                            disabled={socketStatus !== 'connected' || isSearchingBattle}
                                        >
                                            <RotateCcw className={`mr-1.5 h-4 w-4 ${isSearchingBattle ? 'animate-spin' : ''}`} />
                                            Tái trận
                                        </Button>
                                    </motion.div>
                                )}

                                {missingCardId && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -5 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="rounded-lg border border-rose-200 bg-rose-50 p-3 font-mono text-xs text-rose-700"
                                    >
                                        ⚠️ Không tìm thấy từ vựng cho <span className="font-bold underline">card_id: {missingCardId}</span> trên Server API!
                                        <div className="mt-1 text-rose-600">
                                            {autoGuess
                                                ? 'Auto Guess đang bật: hệ thống sẽ dùng gợi ý tiếng Anh để gọi LLM đoán từ, sau đó hẹn gửi khi còn 5-10 giây cuối nếu Auto Answer cũng đang bật.'
                                                : 'Auto Guess đang tắt: hệ thống không gọi LLM, bạn có thể nhập đáp án thủ công hoặc bật Auto Guess trong Cấu hình Auto.'}
                                        </div>
                                    </motion.div>
                                )}

                                {llmGuessStatus && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -5 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="rounded-lg border border-sky-200 bg-sky-50 p-3 font-mono text-xs text-sky-700"
                                    >
                                        🧠 {llmGuessStatus}
                                    </motion.div>
                                )}

                                <div className="grid gap-4 md:grid-cols-3">
                                    <div className="space-y-1 rounded-lg border border-slate-100 bg-slate-50 p-3">
                                        <span className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500">Trận đấu</span>
                                        <div className="text-lg font-bold text-slate-700">{roundText}</div>
                                    </div>
                                    <div className="space-y-1 rounded-lg border border-slate-100 bg-slate-50 p-3">
                                        <span className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500">Mặt nạ từ</span>
                                        <div className="text-lg font-bold tracking-wider text-sky-600">{wordMask}</div>
                                    </div>
                                    <div className="space-y-1 rounded-lg border border-slate-100 bg-slate-50 p-3">
                                        <span className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500">Nghĩa tiếng Việt</span>
                                        <div className="text-lg font-bold text-emerald-600">{wordMeaning}</div>
                                    </div>
                                </div>

                                <div className="space-y-1 rounded-lg border border-slate-100 bg-slate-50/50 p-3">
                                    <span className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500">Ví dụ ẩn từ</span>
                                    <div
                                        className="select-all text-sm italic leading-relaxed text-slate-600"
                                        dangerouslySetInnerHTML={{
                                            __html: `${wordExample.en}<br/><small class="text-slate-400">→ ${wordExample.vi}</small>`,
                                        }}
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        {/* Answer Input */}
                        <Card className="border-emerald-200 bg-emerald-50/30 shadow-sm">
                            <CardContent className="flex flex-wrap items-center gap-3 p-4">
                                <span className="whitespace-nowrap text-xs font-bold uppercase tracking-wider text-emerald-600">Đáp án:</span>
                                <Input
                                    type="text"
                                    value={answerInput}
                                    onChange={(e) => setAnswerInput(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && sendManualAnswer()}
                                    placeholder="Nhập đáp án..."
                                    className="h-10 flex-1 border-emerald-200 bg-white font-mono text-sm font-bold text-emerald-700 placeholder:text-emerald-300 focus:border-emerald-400 focus:ring-emerald-400/20"
                                />
                                <Button size="sm" className="bg-emerald-500 font-bold text-white hover:bg-emerald-600 shadow-sm" onClick={sendManualAnswer}>
                                    <Send className="h-4 w-4" />
                                </Button>
                                {hintAudioUrl && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="border-amber-200 bg-white font-semibold text-amber-700 hover:bg-amber-50"
                                        title={hintPhoneticText ? `Nghe phát âm ${hintPhoneticText}` : 'Nghe hint'}
                                        onClick={playHintAudio}
                                    >
                                        <Volume2 className="mr-1.5 h-4 w-4" />
                                        Nghe
                                    </Button>
                                )}
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-indigo-200 bg-white font-semibold text-indigo-700 hover:bg-indigo-50"
                                    onClick={() => setIsAutoPanelOpen(true)}
                                >
                                    <Zap className="mr-1.5 h-4 w-4" /> Cấu hình Auto
                                </Button>
                                <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                                    {autoSend && <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">Auto Answer</Badge>}
                                    {autoGuess && <Badge className="border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-50">Auto Guess</Badge>}
                                    {autoJoin && <Badge className="border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-50">Tự tìm trận</Badge>}
                                    {autoSyncAfterBattle && <Badge className="border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-50">Auto sync</Badge>}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Opponent & Self Diamonds Card */}
                    <Card className="border-slate-200 bg-white shadow-sm flex flex-col justify-between">
                        <div>
                            <CardHeader className="pb-2 border-b border-slate-100">
                                <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                                    <Users className="h-4 w-4" /> Trạng thái người chơi
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-4 space-y-3">
                                <div className="flex items-center justify-between rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 text-xs font-medium">
                                    <span className="text-indigo-800 flex items-center gap-1.5">
                                        <Activity className="h-4 w-4 text-indigo-500" /> ELO của bạn:
                                    </span>
                                    <span className="font-mono text-sm font-bold text-indigo-600">
                                        {isLoadingBattleActivity ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : myBattleActivity ? (
                                            myBattleActivity.elo.toLocaleString('vi-VN')
                                        ) : (
                                            '---'
                                        )}
                                    </span>
                                </div>

                                <div className="grid grid-cols-2 gap-2 text-[11px] font-semibold text-slate-500">
                                    <div className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5">
                                        Trận: <span className="font-mono text-slate-700">{myBattleActivity?.totalGames ?? '--'}</span>
                                    </div>
                                    <div className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5">
                                        Thắng: <span className="font-mono text-emerald-600">{myBattleActivity?.totalWins ?? '--'}</span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between rounded-xl border border-amber-100 bg-amber-50/50 p-3 text-xs font-medium">
                                    <span className="text-amber-800 flex items-center gap-1.5">
                                        <Gem className="h-4 w-4 text-amber-500" /> Kim cương của bạn:
                                    </span>
                                    <span className="font-mono text-sm font-bold text-amber-600">
                                        {myDiamonds !== null ? `${myDiamonds.toLocaleString('vi-VN')} 🔷` : '---'}
                                    </span>
                                </div>

                                {opponent ? (
                                    <div className="space-y-3">
                                        <div className="relative overflow-hidden rounded-xl border border-sky-100 bg-gradient-to-br from-slate-50 via-white to-sky-50 p-4">
                                            <div className="absolute -right-8 -top-8 h-20 w-20 rounded-full bg-sky-200/40 blur-2xl" />
                                            <div className="relative flex items-center gap-4 flex-col">
                                                {opponent.photoURL ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img
                                                        src={opponent.photoURL}
                                                        className="h-14 w-14 rounded-full border-2 border-sky-200 bg-white object-cover shadow-sm"
                                                        alt="avatar"
                                                    />
                                                ) : (
                                                    <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-sky-200 bg-sky-50 text-xl font-black text-sky-600 shadow-sm">
                                                        {opponent.displayName?.charAt(0).toUpperCase() || '?'}
                                                    </div>
                                                )}

                                                <div className="min-w-0 flex-1 space-y-1 flex flex-col">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="truncate font-bold text-slate-800">{opponent.displayName || 'Đối thủ'}</span>
                                                        {opponent.isPremium && (
                                                            <Badge className="h-4 border-violet-200 bg-violet-100 px-1.5 text-[9px] text-violet-700 hover:bg-violet-200">
                                                                Premium
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <div className="truncate font-mono text-[11px] text-slate-500">UID: {opponent.userId}</div>
                                                    <div className="text-xs font-medium text-sky-600">
                                                        🔷 {opponent.diamonds?.toLocaleString('vi-VN') || 0} kim cương
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                                        <Badge className="border-indigo-200 bg-indigo-50 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100">
                                                            ELO: {isLoadingOpponentBattleActivity ? 'Đang check...' : (opponentBattleActivity?.elo ?? '--')}
                                                        </Badge>
                                                        {opponentBattleActivity && (
                                                            <>
                                                                <Badge variant="outline" className="border-emerald-200 bg-white text-[10px] text-emerald-700">
                                                                    W: {opponentBattleActivity.totalWins}
                                                                </Badge>
                                                                <Badge variant="outline" className="border-rose-200 bg-white text-[10px] text-rose-700">
                                                                    L: {opponentBattleActivity.totalLosses}
                                                                </Badge>
                                                                <Badge variant="outline" className="border-slate-200 bg-white text-[10px] text-slate-600">
                                                                    Games: {opponentBattleActivity.totalGames}
                                                                </Badge>
                                                            </>
                                                        )}
                                                        {opponentBattleActivityError && !isLoadingOpponentBattleActivity && (
                                                            <span
                                                                className="max-w-[220px] truncate text-[10px] font-semibold text-rose-500"
                                                                title={opponentBattleActivityError}
                                                            >
                                                                Lỗi ELO: {opponentBattleActivityError}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="flex shrink-0 items-center gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="border-indigo-200 bg-white font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50"
                                                        onClick={() => loadOpponentBattleActivity(opponent, 'manual')}
                                                        disabled={isLoadingOpponentBattleActivity}
                                                        title="Check lại ELO đối thủ"
                                                    >
                                                        {isLoadingOpponentBattleActivity ? (
                                                            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                                        ) : (
                                                            <Shield className="mr-1.5 h-4 w-4" />
                                                        )}
                                                        ELO
                                                    </Button>

                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className={`relative shrink-0 border-sky-200 bg-white font-semibold text-sky-700 shadow-sm hover:bg-sky-50 ${
                                                            isOpponentMessagesOpen ? 'ring-2 ring-sky-100' : ''
                                                        }`}
                                                        onClick={() => setIsOpponentMessagesOpen((prev) => !prev)}
                                                        title="Xem tin nhắn của đối thủ"
                                                    >
                                                        <MessageSquare className="mr-1.5 h-4 w-4" />
                                                        Tin nhắn
                                                        {opponentMessages.length > 0 && (
                                                            <span className="ml-1.5 rounded-full bg-sky-600 px-1.5 py-0.5 text-[10px] font-black text-white">
                                                                {opponentMessages.length > 99 ? '99+' : opponentMessages.length}
                                                            </span>
                                                        )}
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>

                                        <AnimatePresence>
                                            {isOpponentMessagesOpen && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: -8, scale: 0.98 }}
                                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                                    exit={{ opacity: 0, y: -8, scale: 0.98 }}
                                                    transition={{ duration: 0.18 }}
                                                    className="overflow-hidden rounded-xl border border-sky-100 bg-white shadow-sm"
                                                >
                                                    <div className="flex items-center justify-between border-b border-slate-100 bg-sky-50/70 px-3 py-2">
                                                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sky-700">
                                                            <MessageSquare className="h-4 w-4" />
                                                            Tin nhắn đối thủ
                                                        </div>
                                                        <Badge variant="outline" className="border-sky-200 bg-white text-[10px] text-sky-700">
                                                            {opponentMessages.length} tin
                                                        </Badge>
                                                    </div>

                                                    <div className="max-h-64 space-y-2 overflow-y-auto bg-gradient-to-b from-white to-slate-50 p-3">
                                                        {opponentMessages.length > 0 ? (
                                                            opponentMessages.map((message) => (
                                                                <div key={message.id} className="flex items-start gap-2">
                                                                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-black text-sky-700">
                                                                        {(message.displayName || opponent.displayName || '?').charAt(0).toUpperCase()}
                                                                    </div>
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold text-slate-400">
                                                                            <span className="truncate text-slate-500">
                                                                                {message.displayName || opponent.displayName || 'Đối thủ'}
                                                                            </span>
                                                                            <span>•</span>
                                                                            <span className="font-mono">{message.time}</span>
                                                                        </div>
                                                                        <div className="inline-block max-w-full break-words rounded-2xl rounded-tl-sm border border-sky-100 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
                                                                            {message.text}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))
                                                        ) : (
                                                            <div className="rounded-lg border border-dashed border-sky-100 bg-sky-50/40 px-3 py-6 text-center text-xs text-slate-500">
                                                                Chưa bắt được tin nhắn nào từ đối thủ trong trận này.
                                                            </div>
                                                        )}
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                ) : (
                                    <div className="rounded-xl border-2 border-dashed border-slate-200 py-8 text-center text-sm font-medium text-slate-400 bg-slate-50">
                                        <User className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                                        Chưa vào trận đấu...
                                    </div>
                                )}
                            </CardContent>
                        </div>
                    </Card>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-7">
                    {[
                        { label: 'Tổng sự kiện', val: stats.total, color: 'text-sky-600' },
                        { label: 'Gói tin nhận', val: stats.received, color: 'text-blue-600' },
                        { label: 'Gói tin gửi', val: stats.sent, color: 'text-violet-600' },
                        { label: 'Bạn đúng', val: myCorrectCount, color: 'text-emerald-600' },
                        { label: 'Địch đúng', val: opponentCorrectCount, color: 'text-rose-600' },
                        { label: 'ELO', val: myBattleActivity?.elo ?? '---', color: 'text-indigo-600' },
                        { label: 'W/L', val: `${matchStats.wins}W - ${matchStats.losses}L`, color: 'text-amber-500' },
                    ].map((s, idx) => (
                        <Card key={idx} className="border-slate-200 bg-white shadow-sm">
                            <CardContent className="space-y-1 p-4 text-center">
                                <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">{s.label}</span>
                                <span className={`block text-xl font-bold ${s.color}`}>{s.val}</span>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {/* Tabs */}
                <Tabs defaultValue="events">
                    <TabsList className="h-11 w-full justify-start rounded-b-none border border-slate-200 bg-white p-1">
                        <TabsTrigger
                            value="events"
                            className="px-4 text-xs font-semibold text-slate-500 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-800"
                        >
                            Event Log ({events.length})
                        </TabsTrigger>
                        <TabsTrigger
                            value="collected"
                            className="px-4 text-xs font-semibold text-slate-500 data-[state=active]:bg-emerald-50 data-[state=active]:text-emerald-700"
                        >
                            Thu thập ({collectedVocabs.length})
                        </TabsTrigger>
                        <TabsTrigger
                            value="server"
                            className="px-4 text-xs font-semibold text-slate-500 data-[state=active]:bg-sky-50 data-[state=active]:text-sky-700"
                        >
                            Server ({serverCards.length})
                        </TabsTrigger>
                    </TabsList>

                    {/* Events Tab */}
                    <TabsContent
                        value="events"
                        className="max-h-[480px] overflow-y-auto rounded-b-xl rounded-tr-xl border border-t-0 border-slate-200 bg-white p-4 shadow-sm"
                    >
                        <AnimatePresence initial={false}>
                            {events.length === 0 ? (
                                <div className="py-12 text-center text-xs text-slate-500 flex flex-col items-center justify-center">
                                    <Activity className="h-8 w-8 text-slate-300 mb-2" />
                                    Chưa có gói tin nào. Nhấn Kết nối để bắt đầu.
                                </div>
                            ) : (
                                events.map((e) => (
                                    <motion.div
                                        key={e.id}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0 }}
                                        className={`mb-2 rounded-lg border p-3 font-mono text-xs leading-relaxed ${
                                            e.direction === 'error'
                                                ? 'border-rose-200 bg-rose-50 text-rose-700'
                                                : e.direction === 'auth'
                                                  ? 'border-violet-200 bg-violet-50 text-violet-700'
                                                  : e.direction === 'out'
                                                    ? 'border-indigo-100 bg-indigo-50/50 text-indigo-700'
                                                    : 'border-slate-100 bg-slate-50 text-slate-600'
                                        }`}
                                    >
                                        <div className="mb-1 flex items-center gap-2 border-b border-slate-200/50 pb-1 text-[10px] text-slate-500">
                                            <span className="flex items-center gap-1">
                                                <Clock className="h-3 w-3" /> {e.time}
                                            </span>
                                            <span
                                                className={`font-bold uppercase ${
                                                    e.direction === 'in' ? 'text-sky-600' : e.direction === 'out' ? 'text-violet-600' : 'text-amber-600'
                                                }`}
                                            >
                                                [{e.direction}]
                                            </span>
                                            <span className="font-medium text-slate-600">{e.type}</span>
                                        </div>
                                        <div className="max-h-32 overflow-y-auto break-all mt-1">
                                            {typeof e.data === 'string' ? e.data : JSON.stringify(e.data, null, 2)}
                                        </div>
                                    </motion.div>
                                ))
                            )}
                        </AnimatePresence>
                    </TabsContent>

                    {/* Collected Tab */}
                    <TabsContent value="collected" className="rounded-b-xl rounded-tr-xl border border-t-0 border-slate-200 bg-white p-4 shadow-sm">
                        <div className="mb-3 flex justify-end">
                            <Button
                                size="sm"
                                variant="outline"
                                className="border-emerald-200 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                                onClick={exportCollectedJson}
                                disabled={!collectedVocabs.length}
                            >
                                <Download className="mr-1 h-3.5 w-3.5" /> Xuất JSON
                            </Button>
                        </div>
                        <div className="max-h-[380px] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50">
                            <Table>
                                <TableHeader className="sticky top-0 z-10 bg-white shadow-sm">
                                    <TableRow className="border-slate-200 hover:bg-transparent">
                                        <TableHead className="w-1/3 text-xs font-semibold text-slate-600">Card ID</TableHead>
                                        <TableHead className="w-1/3 text-xs font-semibold text-slate-600">Từ vựng</TableHead>
                                        <TableHead className="w-1/3 text-xs font-semibold text-slate-600">Lưu lúc</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {collectedVocabs.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={3} className="py-8 text-center text-xs text-slate-500">
                                                Chưa thu thập từ mới.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        collectedVocabs.map((v, i) => (
                                            <TableRow key={i} className="border-slate-100 font-mono text-xs hover:bg-slate-100/50">
                                                <TableCell className="select-all text-slate-500">{v.cardId}</TableCell>
                                                <TableCell className="select-all text-sm font-bold text-emerald-600">{v.word}</TableCell>
                                                <TableCell className="text-slate-500">{v.time}</TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </TabsContent>

                    {/* Server Data Tab */}
                    <TabsContent value="server" className="space-y-3 rounded-b-xl rounded-tr-xl border border-t-0 border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
                                API: <Badge className="border-slate-200 bg-white font-mono text-amber-600">{serverDataStatus}</Badge>
                                <span className="font-mono text-[11px] text-slate-400">Sync: {serverLastSyncTime}</span>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 border-sky-200 bg-white text-xs font-semibold text-sky-600 hover:bg-sky-50 hover:text-sky-700"
                                    onClick={loadCardsFromApi}
                                    disabled={isLoadingServerCards}
                                >
                                    <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isLoadingServerCards ? 'animate-spin' : ''}`} />
                                    {isLoadingServerCards ? 'Đang sync...' : 'Load data'}
                                </Button>
                            </div>
                            <div className="relative flex w-full max-w-sm flex-1 items-center">
                                <Search className="absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
                                <Input
                                    type="text"
                                    placeholder="Tìm ID hoặc từ khóa..."
                                    value={serverSearch}
                                    onChange={(e) => setServerSearch(e.target.value)}
                                    className="h-9 border-slate-200 bg-white pl-8 font-mono text-xs placeholder:text-slate-400 focus:ring-sky-500/20 focus:border-sky-500"
                                />
                                {serverSearch && (
                                    <button onClick={() => setServerSearch('')} className="absolute right-2.5 text-slate-400 hover:text-slate-600">
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="max-h-[380px] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50">
                            <Table>
                                <TableHeader className="sticky top-0 z-10 bg-white shadow-sm">
                                    <TableRow className="border-slate-200 hover:bg-transparent">
                                        <TableHead className="w-[10%] text-xs font-semibold text-slate-600">Id</TableHead>
                                        <TableHead className="w-[35%] text-xs font-semibold text-slate-600">Card ID</TableHead>
                                        <TableHead className="w-[40%] text-xs font-semibold text-slate-600">Từ vựng</TableHead>
                                        <TableHead className="w-[15%] text-xs font-semibold text-slate-600">Nguồn</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredServerCards.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="py-8 text-center text-xs text-slate-500">
                                                Không có dữ liệu phù hợp.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredServerCards.slice(0, 300).map((c, idx) => (
                                            <TableRow key={idx} className="border-slate-100 font-mono text-xs hover:bg-slate-100/50">
                                                <TableCell className="text-slate-500">{c.id ?? '--'}</TableCell>
                                                <TableCell className="select-all text-slate-500">{c.card_id}</TableCell>
                                                <TableCell className="select-all text-sm font-bold text-emerald-600">{c.word}</TableCell>
                                                <TableCell>
                                                    <Badge
                                                        className={
                                                            c.source === 'new'
                                                                ? 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                                                                : 'border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                        }
                                                    >
                                                        {c.source}
                                                    </Badge>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
}
