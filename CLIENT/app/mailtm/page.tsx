"use client";

import axios from "axios";
import { useMemo, useState } from "react";

import { api } from "@/lib/api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

type ApiResponse<T> = {
  success: boolean;
  message: string;
  data?: T;
};

type CreatedMailTMEmail = {
  id: string;
  address: string;
  password: string;
  token: string;
  domain: string;
};

type FailedMailTMEmail = {
  index: number;
  message: string;
};

type CreateEmailsData = {
  total_requested: number;
  total_created: number;
  emails: CreatedMailTMEmail[];
  failed?: FailedMailTMEmail[];
};

type MailTMAddress = {
  address: string;
  name: string;
};

type MailTMMessage = {
  id: string;
  accountId: string;
  msgid: string;
  from: MailTMAddress;
  to: MailTMAddress[];
  subject: string;
  intro: string;
  seen: boolean;
  isDeleted: boolean;
  hasAttachments: boolean;
  size: number;
  downloadUrl: string;
  createdAt: string;
  updatedAt: string;
};

type MessagesData = {
  total: number;
  messages: MailTMMessage[];
};

type MailTMAttachment = {
  id: string;
  filename: string;
  contentType: string;
  disposition: string;
  transferEncoding: string;
  related: boolean;
  size: number;
  downloadUrl: string;
};

type MailTMMessageDetail = {
  id: string;
  accountId: string;
  msgid: string;
  from: MailTMAddress;
  to: MailTMAddress[];
  cc?: MailTMAddress[];
  bcc?: MailTMAddress[];
  subject: string;
  intro: string;
  text: string | string[] | null;
  html: string[] | null;
  seen: boolean;
  flagged: boolean;
  isDeleted: boolean;
  hasAttachments: boolean;
  attachments: MailTMAttachment[] | null;
  size: number;
  downloadUrl: string;
  createdAt: string;
  updatedAt: string;
};

type ExtractedLink = {
  href: string;
  text: string;
};

type ProcessStatus = "pending" | "running" | "success" | "error";

type ProcessItem = {
  id: string;
  label: string;
  status: ProcessStatus;
  message?: string;
};

type ParrotoRegisterData = {
  email?: string;
  message?: string;
  [key: string]: unknown;
};

type RegisterStatus = {
  loading: boolean;
  success?: boolean;
  message?: string;
};

type FirebaseEmailLinkSignInData = {
  kind: string;
  idToken: string;
  email: string;
  refreshToken: string;
  expiresIn: string;
  localId: string;
  isNewUser: boolean;
};

type FirebaseProviderUserInfo = {
  providerId: string;
  federatedId: string;
  email: string;
  rawId: string;
};

type FirebaseVerifyUser = {
  localId: string;
  email: string;
  emailVerified: boolean;
  providerUserInfo?: FirebaseProviderUserInfo[];
  validSince?: string;
  lastLoginAt?: string;
  createdAt?: string;
  emailLinkSignin?: boolean;
  lastRefreshAt?: string;
  disabled?: boolean;
};

type FirebaseVerifyTokenData = {
  kind: string;
  user: FirebaseVerifyUser;
  users: FirebaseVerifyUser[];
};

type TokenStatus = {
  loading: boolean;
  verifying?: boolean;
  success?: boolean;
  verified?: boolean;
  message?: string;
  data?: FirebaseEmailLinkSignInData;
  verifyData?: FirebaseVerifyTokenData;
};

function getErrorMessage(error: unknown) {
  if (axios.isAxiosError<ApiResponse<unknown>>(error)) {
    return error.response?.data?.message || error.message || "Có lỗi xảy ra.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Có lỗi xảy ra.";
}

function getMessageText(value: string | string[] | null) {
  if (!value) return "";

  if (Array.isArray(value)) {
    return value.join("\n");
  }

  return value;
}

function extractLinksFromHtml(html: string[] | null): ExtractedLink[] {
  if (!html || html.length === 0) return [];

  const rawHtml = html.join("\n");

  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, "text/html");

  const links = Array.from(doc.querySelectorAll("a"));

  return links
    .map((link) => {
      const href = link.getAttribute("href") || "";
      const text = link.textContent?.trim() || href;

      return {
        href,
        text,
      };
    })
    .filter((item) => {
      return item.href.startsWith("http://") || item.href.startsWith("https://");
    });
}

function mergeEmailsByAddress(
  oldEmails: CreatedMailTMEmail[],
  newEmails: CreatedMailTMEmail[]
) {
  const map = new Map<string, CreatedMailTMEmail>();

  oldEmails.forEach((email) => {
    map.set(email.address, email);
  });

  newEmails.forEach((email) => {
    map.set(email.address, email);
  });

  return Array.from(map.values());
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
) {
  let currentIndex = 0;

  async function runWorker() {
    while (currentIndex < items.length) {
      const index = currentIndex;
      currentIndex += 1;

      await worker(items[index], index);
    }
  }

  const workers = Array.from(
    {
      length: Math.min(concurrency, items.length),
    },
    () => runWorker()
  );

  await Promise.all(workers);
}

export default function MailTMPage() {
  const [amount, setAmount] = useState("1");

  const [emails, setEmails] = useState<CreatedMailTMEmail[]>([]);
  const [failed, setFailed] = useState<FailedMailTMEmail[]>([]);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const [messagesByEmail, setMessagesByEmail] = useState<
    Record<string, MailTMMessage[]>
  >({});

  const [loadingMessages, setLoadingMessages] = useState<
    Record<string, boolean>
  >({});

  const [messageDetailById, setMessageDetailById] = useState<
    Record<string, MailTMMessageDetail>
  >({});

  const [loadingMessageDetail, setLoadingMessageDetail] = useState<
    Record<string, boolean>
  >({});

  const [registerStatusByEmail, setRegisterStatusByEmail] = useState<
    Record<string, RegisterStatus>
  >({});

  const [tokenStatusByEmail, setTokenStatusByEmail] = useState<
    Record<string, TokenStatus>
  >({});

  const [processOpen, setProcessOpen] = useState(false);
  const [processRunning, setProcessRunning] = useState(false);
  const [processItems, setProcessItems] = useState<ProcessItem[]>([]);
  const [processTotal, setProcessTotal] = useState(0);
  const [processDone, setProcessDone] = useState(0);

  const [registerAllOpen, setRegisterAllOpen] = useState(false);
  const [registerAllRunning, setRegisterAllRunning] = useState(false);
  const [registerAllItems, setRegisterAllItems] = useState<ProcessItem[]>([]);
  const [registerAllTotal, setRegisterAllTotal] = useState(0);
  const [registerAllDone, setRegisterAllDone] = useState(0);

  const totalCreated = useMemo(() => emails.length, [emails]);

  const allExtractedLinks = useMemo(() => {
    const linkMap = new Map<string, ExtractedLink>();

    Object.values(messageDetailById).forEach((detail) => {
      const links = extractLinksFromHtml(detail.html);

      links.forEach((link) => {
        if (!linkMap.has(link.href)) {
          linkMap.set(link.href, link);
        }
      });
    });

    return Array.from(linkMap.values());
  }, [messageDetailById]);

  const processPercent = useMemo(() => {
    if (processTotal <= 0) return 0;
    return Math.round((processDone / processTotal) * 100);
  }, [processDone, processTotal]);

  const registerAllPercent = useMemo(() => {
    if (registerAllTotal <= 0) return 0;
    return Math.round((registerAllDone / registerAllTotal) * 100);
  }, [registerAllDone, registerAllTotal]);

  function updateProcessItem(
    id: string,
    patch: Partial<Omit<ProcessItem, "id">>
  ) {
    setProcessItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;

        return {
          ...item,
          ...patch,
        };
      })
    );
  }

  function addProcessItems(items: ProcessItem[]) {
    setProcessItems((prev) => [...prev, ...items]);
  }

  function updateRegisterAllItem(
    id: string,
    patch: Partial<Omit<ProcessItem, "id">>
  ) {
    setRegisterAllItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;

        return {
          ...item,
          ...patch,
        };
      })
    );
  }

  function handleClearEmails() {
    setEmails([]);
    setFailed([]);
    setError("");

    setMessagesByEmail({});
    setLoadingMessages({});

    setMessageDetailById({});
    setLoadingMessageDetail({});

    setRegisterStatusByEmail({});
    setTokenStatusByEmail({});

    setProcessOpen(false);
    setProcessRunning(false);
    setProcessItems([]);
    setProcessTotal(0);
    setProcessDone(0);

    setRegisterAllOpen(false);
    setRegisterAllRunning(false);
    setRegisterAllItems([]);
    setRegisterAllTotal(0);
    setRegisterAllDone(0);
  }

  async function handleCreateEmails() {
    setError("");
    setFailed([]);

    const parsedAmount = Number(amount);

    if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
      setError("Số lượng email phải là số nguyên lớn hơn 0.");
      return;
    }

    if (parsedAmount > 10) {
      setError("Số lượng email tối đa là 10.");
      return;
    }

    try {
      setCreating(true);

      const res = await api.post<ApiResponse<CreateEmailsData>>("/mailtm", {
        amount: parsedAmount,
      });

      if (!res.data.success || !res.data.data) {
        throw new Error(res.data.message || "Tạo email thất bại.");
      }

      const newEmails = res.data.data.emails || [];

      setEmails((prev) => mergeEmailsByAddress(prev, newEmails));
      setFailed(res.data.data.failed || []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function registerParrotoEmail(email: CreatedMailTMEmail) {
    const res = await api.post<ApiResponse<ParrotoRegisterData>>(
      "/parroto/register",
      {
        email: email.address,
      }
    );

    if (!res.data.success) {
      throw new Error(res.data.message || "Đăng ký Parroto thất bại.");
    }

    return res.data.message || "Đăng ký Parroto thành công.";
  }

  async function handleRegisterParroto(email: CreatedMailTMEmail) {
    setError("");

    try {
      setRegisterStatusByEmail((prev) => ({
        ...prev,
        [email.address]: {
          loading: true,
          message: "Đang đăng ký Parroto...",
        },
      }));

      const message = await registerParrotoEmail(email);

      setRegisterStatusByEmail((prev) => ({
        ...prev,
        [email.address]: {
          loading: false,
          success: true,
          message,
        },
      }));
    } catch (err) {
      const message = getErrorMessage(err);

      setRegisterStatusByEmail((prev) => ({
        ...prev,
        [email.address]: {
          loading: false,
          success: false,
          message,
        },
      }));

      setError(message);
    }
  }

  async function handleRegisterParrotoAllEmails() {
    if (emails.length === 0) {
      setError("Chưa có email nào để đăng ký Parroto.");
      return;
    }

    setError("");
    setRegisterAllOpen(true);
    setRegisterAllRunning(true);
    setRegisterAllDone(0);
    setRegisterAllTotal(emails.length);

    const initialItems: ProcessItem[] = emails.map((email) => ({
      id: `register-${email.address}`,
      label: `Register Parroto: ${email.address}`,
      status: "pending",
    }));

    setRegisterAllItems(initialItems);

    try {
      await runWithConcurrency(emails, 3, async (email) => {
        const itemID = `register-${email.address}`;

        updateRegisterAllItem(itemID, {
          status: "running",
          message: "Đang đăng ký Parroto...",
        });

        setRegisterStatusByEmail((prev) => ({
          ...prev,
          [email.address]: {
            loading: true,
            message: "Đang đăng ký Parroto...",
          },
        }));

        try {
          const message = await registerParrotoEmail(email);

          setRegisterStatusByEmail((prev) => ({
            ...prev,
            [email.address]: {
              loading: false,
              success: true,
              message,
            },
          }));

          updateRegisterAllItem(itemID, {
            status: "success",
            message,
          });
        } catch (err) {
          const message = getErrorMessage(err);

          setRegisterStatusByEmail((prev) => ({
            ...prev,
            [email.address]: {
              loading: false,
              success: false,
              message,
            },
          }));

          updateRegisterAllItem(itemID, {
            status: "error",
            message,
          });
        } finally {
          setRegisterAllDone((prev) => prev + 1);
        }
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRegisterAllRunning(false);
    }
  }

  async function fetchMessages(email: CreatedMailTMEmail) {
    const res = await api.get<ApiResponse<MessagesData>>("/mailtm/messages", {
      headers: {
        Authorization: `Bearer ${email.token}`,
      },
    });

    if (!res.data.success || !res.data.data) {
      throw new Error(res.data.message || "Lấy message thất bại.");
    }

    return res.data.data.messages || [];
  }

  async function fetchFullMessage(
    email: CreatedMailTMEmail,
    messageId: string
  ) {
    const res = await api.get<ApiResponse<MailTMMessageDetail>>(
      "/mailtm/messages",
      {
        params: {
          id: messageId,
        },
        headers: {
          Authorization: `Bearer ${email.token}`,
        },
      }
    );

    if (!res.data.success || !res.data.data) {
      throw new Error(res.data.message || "Lấy full message thất bại.");
    }

    return res.data.data;
  }

  async function fetchMessagesWithFullDetails(email: CreatedMailTMEmail) {
    const messages = await fetchMessages(email);

    setMessagesByEmail((prev) => ({
      ...prev,
      [email.address]: messages,
    }));

    if (messages.length === 0) {
      return {
        messages,
        details: [] as MailTMMessageDetail[],
      };
    }

    const detailMap: Record<string, MailTMMessageDetail> = {};

    messages.forEach((message) => {
      setLoadingMessageDetail((prev) => ({
        ...prev,
        [message.id]: true,
      }));
    });

    await runWithConcurrency(messages, 5, async (message) => {
      try {
        const detail = await fetchFullMessage(email, message.id);
        detailMap[message.id] = detail;
      } finally {
        setLoadingMessageDetail((prev) => ({
          ...prev,
          [message.id]: false,
        }));
      }
    });

    setMessageDetailById((prev) => ({
      ...prev,
      ...detailMap,
    }));

    return {
      messages,
      details: Object.values(detailMap),
    };
  }

  function findBestParrotoMessageDetail(details: MailTMMessageDetail[]) {
    return (
      details.find((detail) => {
        const fromAddress = detail.from?.address?.toLowerCase() || "";
        const subject = detail.subject?.toLowerCase() || "";
        const htmlRaw = detail.html?.join("\n") || "";
        const textRaw = getMessageText(detail.text);

        return (
          fromAddress.includes("parroto") ||
          subject.includes("parroto") ||
          htmlRaw.includes("oobCode=") ||
          textRaw.includes("oobCode=")
        );
      }) || details[0]
    );
  }

  async function signInWithEmailLink(
    email: CreatedMailTMEmail,
    detail: MailTMMessageDetail
  ) {
    const links = extractLinksFromHtml(detail.html);
    const signInLink =
      links.find((link) => link.href.includes("oobCode="))?.href ||
      links[0]?.href ||
      "";

    const res = await api.post<ApiResponse<FirebaseEmailLinkSignInData>>(
      "/get-token",
      {
        email: email.address,
        signInLink,
        link: signInLink,
        text: getMessageText(detail.text) || detail.intro || "",
        html: detail.html || [],
      }
    );

    if (!res.data.success || !res.data.data) {
      throw new Error(res.data.message || "Get token thất bại.");
    }

    return res.data.data;
  }

  async function verifyFirebaseToken(idToken: string) {
    const res = await api.post<ApiResponse<FirebaseVerifyTokenData>>(
      "/verify-token",
      {
        idToken,
      }
    );

    if (!res.data.success || !res.data.data) {
      throw new Error(res.data.message || "Verify account thất bại.");
    }

    return res.data.data;
  }

  async function handleGetMessages(email: CreatedMailTMEmail) {
    setError("");

    try {
      setLoadingMessages((prev) => ({
        ...prev,
        [email.address]: true,
      }));

      await fetchMessagesWithFullDetails(email);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoadingMessages((prev) => ({
        ...prev,
        [email.address]: false,
      }));
    }
  }

  async function handleGetFullMessage(
    email: CreatedMailTMEmail,
    messageId: string
  ) {
    setError("");

    try {
      setLoadingMessageDetail((prev) => ({
        ...prev,
        [messageId]: true,
      }));

      const detail = await fetchFullMessage(email, messageId);

      setMessageDetailById((prev) => ({
        ...prev,
        [messageId]: detail,
      }));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoadingMessageDetail((prev) => ({
        ...prev,
        [messageId]: false,
      }));
    }
  }

  async function handleGetToken(
    email: CreatedMailTMEmail,
    messageId?: string
  ) {
    setError("");

    try {
      setTokenStatusByEmail((prev) => ({
        ...prev,
        [email.address]: {
          loading: true,
          verifying: false,
          message: messageId
            ? "Đang lấy token từ message đã chọn..."
            : "Đang lấy message, full message và token...",
        },
      }));

      let detail: MailTMMessageDetail | undefined;

      if (messageId) {
        detail = messageDetailById[messageId];
        if (!detail) {
          detail = await fetchFullMessage(email, messageId);
          setMessageDetailById((prev) => ({
            ...prev,
            [messageId]: detail!,
          }));
        }
      } else {
        const currentMessages = messagesByEmail[email.address] || [];
        let details = currentMessages
          .map((message) => messageDetailById[message.id])
          .filter((item): item is MailTMMessageDetail => Boolean(item));

        if (currentMessages.length === 0 || details.length === 0) {
          const loaded = await fetchMessagesWithFullDetails(email);
          details = loaded.details;
        }

        detail = findBestParrotoMessageDetail(details);
      }

      if (!detail) {
        throw new Error("Không tìm thấy full message để lấy token.");
      }

      const tokenData = await signInWithEmailLink(email, detail);

      setTokenStatusByEmail((prev) => ({
        ...prev,
        [email.address]: {
          loading: true,
          verifying: true,
          success: true,
          message: `Lấy token thành công. Đang verify account...`,
          data: tokenData,
        },
      }));

      const verifyData = await verifyFirebaseToken(tokenData.idToken);
      const verifiedUser = verifyData.user || verifyData.users?.[0];

      setTokenStatusByEmail((prev) => ({
        ...prev,
        [email.address]: {
          loading: false,
          verifying: false,
          success: true,
          verified: true,
          message: `Verify account thành công. Email: ${verifiedUser?.email || tokenData.email} • Local ID: ${verifiedUser?.localId || tokenData.localId}`,
          data: tokenData,
          verifyData,
        },
      }));
    } catch (err) {
      const message = getErrorMessage(err);

      setTokenStatusByEmail((prev) => ({
        ...prev,
        [email.address]: {
          loading: false,
          success: false,
          message,
        },
      }));

      setError(message);
    }
  }

  async function handleAutoProcess() {
    if (emails.length === 0) {
      setError("Chưa có email nào để xử lý.");
      return;
    }

    setError("");
    setProcessOpen(true);
    setProcessRunning(true);
    setProcessItems([]);
    setProcessDone(0);
    setProcessTotal(emails.length);

    const allMessageTasks: Array<{
      email: CreatedMailTMEmail;
      message: MailTMMessage;
    }> = [];

    const initialItems: ProcessItem[] = emails.map((email) => ({
      id: `list-${email.address}`,
      label: `Get messages: ${email.address}`,
      status: "pending",
    }));

    setProcessItems(initialItems);

    try {
      await runWithConcurrency(emails, 3, async (email) => {
        const itemID = `list-${email.address}`;

        updateProcessItem(itemID, {
          status: "running",
          message: "Đang lấy danh sách message...",
        });

        try {
          const messages = await fetchMessages(email);

          setMessagesByEmail((prev) => ({
            ...prev,
            [email.address]: messages,
          }));

          messages.forEach((message) => {
            allMessageTasks.push({
              email,
              message,
            });
          });

          updateProcessItem(itemID, {
            status: "success",
            message: `Tìm thấy ${messages.length} message`,
          });
        } catch (err) {
          updateProcessItem(itemID, {
            status: "error",
            message: getErrorMessage(err),
          });
        } finally {
          setProcessDone((prev) => prev + 1);
        }
      });

      const fullMessageItems: ProcessItem[] = allMessageTasks.map((task) => ({
        id: `full-${task.message.id}`,
        label: `Get full: ${task.email.address} / ${task.message.subject || task.message.id
          }`,
        status: "pending",
      }));

      addProcessItems(fullMessageItems);
      setProcessTotal((prev) => prev + fullMessageItems.length);

      await runWithConcurrency(allMessageTasks, 5, async (task) => {
        const itemID = `full-${task.message.id}`;

        updateProcessItem(itemID, {
          status: "running",
          message: "Đang lấy full message...",
        });

        try {
          const detail = await fetchFullMessage(task.email, task.message.id);
          const links = extractLinksFromHtml(detail.html);

          setMessageDetailById((prev) => ({
            ...prev,
            [task.message.id]: detail,
          }));

          updateProcessItem(itemID, {
            status: "success",
            message:
              links.length > 0
                ? `Đã lấy full message, tìm thấy ${links.length} link`
                : "Đã lấy full message, không có link",
          });
        } catch (err) {
          updateProcessItem(itemID, {
            status: "error",
            message: getErrorMessage(err),
          });
        } finally {
          setProcessDone((prev) => prev + 1);
        }
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setProcessRunning(false);
    }
  }

  function handleOpenAllLinks() {
    if (allExtractedLinks.length === 0) {
      setError("Chưa có link nào. Hãy bấm Auto process messages trước.");
      return;
    }

    setError("");

    let opened = 0;
    let blocked = 0;

    allExtractedLinks.forEach((link) => {
      const tab = window.open("about:blank", "_blank");

      if (!tab) {
        blocked += 1;
        return;
      }

      try {
        tab.opener = null;
        tab.location.href = link.href;
        opened += 1;
      } catch {
        try {
          tab.close();
        } catch {
          // Ignore close error.
        }

        blocked += 1;
      }
    });

    if (blocked > 0) {
      setError(
        `Đã mở ${opened}/${allExtractedLinks.length} link. Có ${blocked} tab bị trình duyệt chặn popup. Hãy cho phép popup của website rồi bấm lại Open all links.`
      );
    }
  }

  async function handleCopyAllLinks() {
    if (allExtractedLinks.length === 0) {
      setError("Chưa có link nào để copy.");
      return;
    }

    const text = allExtractedLinks.map((x) => x.href).join("\n");
    await navigator.clipboard.writeText(text);
  }

  async function copyText(value: string) {
    await navigator.clipboard.writeText(value);
  }

  return (
    <main className="min-h-screen bg-muted/40 p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Mail.tm Email Generator
          </h1>

          <p className="mt-1 text-sm text-muted-foreground">
            Tạo email tạm thời, đăng ký Parroto, lấy message/full message, lấy token và verify account.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Tạo email</CardTitle>
            <CardDescription>
              Nhập số lượng email cần tạo, tối đa 10 email mỗi lần. Nếu không
              Clear emails, danh sách mới sẽ được gộp vào danh sách cũ.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="amount">Số lượng email cần tạo</Label>

              <div className="flex flex-wrap gap-3">
                <Input
                  id="amount"
                  type="number"
                  min={1}
                  max={10}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Ví dụ: 3"
                  className="max-w-xs"
                />

                <Button onClick={handleCreateEmails} disabled={creating}>
                  {creating ? "Đang tạo..." : "Gửi"}
                </Button>

                <Button
                  variant="destructive"
                  onClick={handleClearEmails}
                  disabled={
                    creating ||
                    processRunning ||
                    registerAllRunning ||
                    emails.length === 0
                  }
                >
                  Clear emails
                </Button>

                <Button
                  variant="outline"
                  onClick={handleAutoProcess}
                  disabled={
                    processRunning || registerAllRunning || emails.length === 0
                  }
                >
                  Auto process messages
                </Button>

                <Button
                  variant="outline"
                  onClick={handleRegisterParrotoAllEmails}
                  disabled={
                    processRunning || registerAllRunning || emails.length === 0
                  }
                >
                  {registerAllRunning
                    ? "Đang register..."
                    : "Register Parroto all emails"}
                </Button>

                <Button
                  variant="outline"
                  onClick={handleOpenAllLinks}
                  disabled={allExtractedLinks.length === 0}
                >
                  Open all links ({allExtractedLinks.length})
                </Button>

                <Button
                  variant="outline"
                  onClick={handleCopyAllLinks}
                  disabled={allExtractedLinks.length === 0}
                >
                  Copy all links
                </Button>
              </div>
            </div>

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {failed.length > 0 && (
              <div className="rounded-md border bg-background px-4 py-3 text-sm">
                <p className="font-medium">Một số email tạo thất bại:</p>

                <ul className="mt-2 list-inside list-disc text-muted-foreground">
                  {failed.map((item) => (
                    <li key={item.index}>
                      Dòng {item.index}: {item.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {emails.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>Email đã tạo</CardTitle>
                  <CardDescription>
                    Tổng số email hiện có: {totalCreated}
                  </CardDescription>
                </div>

                <Badge variant="secondary">{totalCreated} email</Badge>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {emails.map((email, index) => {
                const messages = messagesByEmail[email.address] || [];
                const isLoadingMessage = loadingMessages[email.address];
                const registerStatus = registerStatusByEmail[email.address];
                const tokenStatus = tokenStatusByEmail[email.address];

                return (
                  <div
                    key={email.address}
                    className="rounded-lg border bg-background p-4"
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">#{index + 1}</Badge>

                          <p className="break-all font-medium">
                            {email.address}
                          </p>
                        </div>

                        <div className="space-y-1 text-sm text-muted-foreground">
                          <p>Domain: {email.domain}</p>
                          <p>Password: {email.password}</p>
                        </div>

                        {registerStatus?.message && (
                          <div
                            className={
                              registerStatus.loading
                                ? "rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground"
                                : registerStatus.success
                                  ? "rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-700"
                                  : "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                            }
                          >
                            {registerStatus.message}
                          </div>
                        )}

                        {tokenStatus?.message && (
                          <div
                            className={
                              tokenStatus.loading
                                ? "rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground"
                                : tokenStatus.success
                                  ? "rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700"
                                  : "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                            }
                          >
                            <p>{tokenStatus.message}</p>

                            {tokenStatus.verifyData?.user && (
                              <div className="mt-2 rounded-md border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                                <p>Verified: {tokenStatus.verifyData.user.emailVerified ? "true" : "false"}</p>
                                <p>Email: {tokenStatus.verifyData.user.email}</p>
                                <p>Local ID: {tokenStatus.verifyData.user.localId}</p>
                                {tokenStatus.verifyData.user.lastRefreshAt && (
                                  <p>Last refresh: {tokenStatus.verifyData.user.lastRefreshAt}</p>
                                )}
                              </div>
                            )}

                            {tokenStatus.data && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => copyText(tokenStatus.data?.idToken || "")}
                                >
                                  Copy idToken
                                </Button>

                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    copyText(tokenStatus.data?.refreshToken || "")
                                  }
                                >
                                  Copy refreshToken
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyText(email.address)}
                        >
                          Copy email
                        </Button>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyText(email.password)}
                        >
                          Copy password
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRegisterParroto(email)}
                          disabled={
                            registerStatus?.loading || registerAllRunning
                          }
                        >
                          {registerStatus?.loading
                            ? "Đang đăng ký..."
                            : "Register Parroto"}
                        </Button>

                        <Button
                          size="sm"
                          onClick={() => handleGetMessages(email)}
                          disabled={isLoadingMessage || processRunning}
                        >
                          {isLoadingMessage ? "Đang lấy full..." : "Get message"}
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleGetToken(email)}
                          disabled={
                            tokenStatus?.loading ||
                            isLoadingMessage ||
                            processRunning
                          }
                        >
                          {tokenStatus?.loading ? "Đang verify..." : "Verify account"}
                        </Button>
                      </div>
                    </div>

                    <Separator className="my-4" />

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">Messages</p>
                        <Badge variant="secondary">{messages.length}</Badge>
                      </div>

                      {messages.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Chưa có message hoặc chưa bấm Get message. Khi bấm Get message, hệ thống sẽ tự lấy full message luôn.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {messages.map((message) => {
                            const detail = messageDetailById[message.id];
                            const isLoadingDetail =
                              loadingMessageDetail[message.id];

                            const fullText = detail
                              ? getMessageText(detail.text)
                              : "";

                            const links = detail
                              ? extractLinksFromHtml(detail.html)
                              : [];

                            return (
                              <div
                                key={message.id}
                                className="rounded-md border bg-muted/30 p-3"
                              >
                                <div className="flex flex-col gap-3">
                                  <div>
                                    <p className="font-medium">
                                      {message.subject || "(Không có tiêu đề)"}
                                    </p>

                                    <p className="text-sm text-muted-foreground">
                                      From:{" "}
                                      {message.from?.name
                                        ? `${message.from.name} <${message.from.address}>`
                                        : message.from?.address}
                                    </p>

                                    <p className="mt-2 text-sm">
                                      {message.intro}
                                    </p>
                                  </div>

                                  <div className="flex flex-wrap gap-2">
                                    <Badge variant="outline">
                                      {message.seen ? "Đã đọc" : "Chưa đọc"}
                                    </Badge>

                                    {message.hasAttachments && (
                                      <Badge variant="outline">
                                        Có file đính kèm
                                      </Badge>
                                    )}

                                    <Badge variant="outline">
                                      {message.createdAt
                                        ? new Date(
                                          message.createdAt
                                        ).toLocaleString("vi-VN")
                                        : "Không rõ thời gian"}
                                    </Badge>
                                  </div>

                                  <div className="flex flex-wrap gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        handleGetFullMessage(email, message.id)
                                      }
                                      disabled={isLoadingDetail || processRunning}
                                    >
                                      {isLoadingDetail
                                        ? "Đang lấy full..."
                                        : detail
                                          ? "Tải lại full message"
                                          : "Đang chờ full message"}
                                    </Button>

                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => copyText(message.id)}
                                    >
                                      Copy message id
                                    </Button>

                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        handleGetToken(email, message.id)
                                      }
                                      disabled={
                                        tokenStatus?.loading ||
                                        isLoadingDetail ||
                                        processRunning
                                      }
                                    >
                                      {tokenStatus?.loading
                                        ? "Đang verify..."
                                        : "Verify account"}
                                    </Button>
                                  </div>

                                  {detail && (
                                    <div className="mt-3 space-y-3 rounded-md border bg-background p-3">
                                      <div className="space-y-1">
                                        <p className="text-sm font-medium">
                                          Full message info
                                        </p>

                                        <div className="text-sm text-muted-foreground">
                                          <p>
                                            Subject:{" "}
                                            {detail.subject ||
                                              "(Không có tiêu đề)"}
                                          </p>

                                          <p>
                                            From:{" "}
                                            {detail.from?.name
                                              ? `${detail.from.name} <${detail.from.address}>`
                                              : detail.from?.address}
                                          </p>

                                          <p>
                                            To:{" "}
                                            {detail.to
                                              ?.map((x) => x.address)
                                              .join(", ")}
                                          </p>

                                          <p>Size: {detail.size} bytes</p>
                                        </div>
                                      </div>

                                      <Separator />

                                      <div>
                                        <div className="mb-2 flex items-center justify-between gap-2">
                                          <p className="text-sm font-medium">
                                            Full text
                                          </p>

                                          {fullText && (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() => copyText(fullText)}
                                            >
                                              Copy text
                                            </Button>
                                          )}
                                        </div>

                                        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm">
                                          {fullText ||
                                            "(Email không có nội dung text)"}
                                        </pre>
                                      </div>

                                      {links.length > 0 && (
                                        <div className="space-y-2">
                                          <p className="text-sm font-medium">
                                            Links
                                          </p>

                                          <div className="space-y-2">
                                            {links.map((link, linkIndex) => (
                                              <div
                                                key={`${link.href}-${linkIndex}`}
                                                className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between"
                                              >
                                                <div className="min-w-0">
                                                  <p className="text-sm font-medium">
                                                    {link.text ||
                                                      `Link ${linkIndex + 1}`}
                                                  </p>

                                                  <p className="break-all text-xs text-muted-foreground">
                                                    {link.href}
                                                  </p>
                                                </div>

                                                <div className="flex shrink-0 gap-2">
                                                  <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() =>
                                                      copyText(link.href)
                                                    }
                                                  >
                                                    Copy link
                                                  </Button>

                                                  <a
                                                    href={link.href}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
                                                  >
                                                    Open link
                                                  </a>
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}

                                      {detail.html &&
                                        detail.html.length > 0 && (
                                          <details className="rounded-md border p-3">
                                            <summary className="cursor-pointer text-sm font-medium">
                                              Xem HTML raw
                                            </summary>

                                            <div className="mt-3 flex justify-end">
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() =>
                                                  copyText(
                                                    detail.html?.join("\n") ||
                                                    ""
                                                  )
                                                }
                                              >
                                                Copy HTML
                                              </Button>
                                            </div>

                                            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">
                                              {detail.html.join("\n")}
                                            </pre>
                                          </details>
                                        )}

                                      {detail.attachments &&
                                        detail.attachments.length > 0 && (
                                          <div>
                                            <p className="text-sm font-medium">
                                              Attachments
                                            </p>

                                            <div className="mt-2 space-y-2">
                                              {detail.attachments.map((file) => (
                                                <div
                                                  key={file.id}
                                                  className="rounded-md border px-3 py-2 text-sm"
                                                >
                                                  <p className="font-medium">
                                                    {file.filename}
                                                  </p>

                                                  <p className="text-muted-foreground">
                                                    {file.contentType} -{" "}
                                                    {file.size} bytes
                                                  </p>

                                                  <p className="break-all text-muted-foreground">
                                                    {file.downloadUrl}
                                                  </p>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={processOpen} onOpenChange={setProcessOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Auto process messages</DialogTitle>
            <DialogDescription>
              Tự động lấy danh sách message và full message theo từng email.
              Sau khi chạy xong, bạn có thể bấm Open all links để mở tất cả
              link tìm được.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>
                  Tiến trình: {processDone}/{processTotal}
                </span>
                <span>{processPercent}%</span>
              </div>

              <Progress value={processPercent} />
            </div>

            <div className="max-h-[420px] space-y-2 overflow-auto rounded-md border p-3">
              {processItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Chưa có process nào.
                </p>
              ) : (
                processItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col gap-1 rounded-md border bg-background p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="break-all text-sm font-medium">
                        {item.label}
                      </p>

                      <Badge
                        variant={
                          item.status === "success"
                            ? "default"
                            : item.status === "error"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {item.status}
                      </Badge>
                    </div>

                    {item.message && (
                      <p className="text-xs text-muted-foreground">
                        {item.message}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                onClick={handleRegisterParrotoAllEmails}
                disabled={
                  processRunning || registerAllRunning || emails.length === 0
                }
              >
                {registerAllRunning
                  ? "Đang register..."
                  : "Register Parroto all emails"}
              </Button>

              <Button
                variant="outline"
                onClick={handleCopyAllLinks}
                disabled={allExtractedLinks.length === 0}
              >
                Copy all links
              </Button>

              <Button
                onClick={handleOpenAllLinks}
                disabled={processRunning || allExtractedLinks.length === 0}
              >
                Open all links ({allExtractedLinks.length})
              </Button>

              <Button
                variant="outline"
                onClick={() => setProcessOpen(false)}
                disabled={processRunning}
              >
                {processRunning ? "Đang chạy..." : "Đóng"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={registerAllOpen} onOpenChange={setRegisterAllOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Register Parroto all emails</DialogTitle>
            <DialogDescription>
              Tự động đăng ký Parroto cho toàn bộ email đang có trong danh sách.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>
                  Tiến trình: {registerAllDone}/{registerAllTotal}
                </span>
                <span>{registerAllPercent}%</span>
              </div>

              <Progress value={registerAllPercent} />
            </div>

            <div className="max-h-[420px] space-y-2 overflow-auto rounded-md border p-3">
              {registerAllItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Chưa có email nào đang register.
                </p>
              ) : (
                registerAllItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col gap-1 rounded-md border bg-background p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="break-all text-sm font-medium">
                        {item.label}
                      </p>

                      <Badge
                        variant={
                          item.status === "success"
                            ? "default"
                            : item.status === "error"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {item.status}
                      </Badge>
                    </div>

                    {item.message && (
                      <p className="text-xs text-muted-foreground">
                        {item.message}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setRegisterAllOpen(false)}
                disabled={registerAllRunning}
              >
                {registerAllRunning ? "Đang chạy..." : "Đóng"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}