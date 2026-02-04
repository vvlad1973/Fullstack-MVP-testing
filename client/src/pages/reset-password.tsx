import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound, ArrowLeft, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { t } from "@/lib/i18n";

const passwordRegex = /^[A-Za-z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]+$/;

const resetPasswordSchema = z.object({
  newPassword: z.string()
    .min(8, t.users.passwordMinLength)
    .regex(passwordRegex, t.users.passwordInvalidChars),
  confirmPassword: z.string().min(1, t.users.passwordRequired),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: t.auth.passwordsDoNotMatch,
  path: ["confirmPassword"],
});

type ResetPasswordData = z.infer<typeof resetPasswordSchema>;

export default function ResetPasswordPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  
  const [token, setToken] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(true);
  const [isValidToken, setIsValidToken] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const form = useForm<ResetPasswordData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      newPassword: "",
      confirmPassword: "",
    },
  });

  // Получаем токен из URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    setToken(urlToken);

    if (urlToken) {
      verifyToken(urlToken);
    } else {
      setIsVerifying(false);
      setIsValidToken(false);
    }
  }, []);

  const verifyToken = async (tokenToVerify: string) => {
    try {
      const res = await fetch(`/api/auth/verify-reset-token?token=${tokenToVerify}`);
      const data = await res.json();
      setIsValidToken(data.valid === true);
    } catch (error) {
      setIsValidToken(false);
    } finally {
      setIsVerifying(false);
    }
  };

  const onSubmit = async (data: ResetPasswordData) => {
    if (!token) return;

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          newPassword: data.newPassword,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        toast({
          variant: "destructive",
          title: t.common.error,
          description: result.error || t.auth.somethingWentWrong,
        });
        return;
      }

      setIsSuccess(true);
    } catch (error) {
      toast({
        variant: "destructive",
        title: t.common.error,
        description: t.auth.somethingWentWrong,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Загрузка
  if (isVerifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Невалидный токен
  if (!isValidToken && !isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center">
              <XCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <CardTitle>{t.auth.invalidOrExpiredToken}</CardTitle>
            <CardDescription className="mt-2">
              {t.auth.invalidOrExpiredTokenDescription}
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex flex-col gap-2">
            <Link href="/forgot-password" className="w-full">
              <Button className="w-full">
                {t.auth.requestNewLink}
              </Button>
            </Link>
            <Link href="/login" className="w-full">
              <Button variant="ghost" className="w-full">
                <ArrowLeft className="h-4 w-4 mr-2" />
                {t.auth.backToLogin}
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Успех
  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle>{t.auth.passwordResetSuccess}</CardTitle>
            <CardDescription className="mt-2">
              {t.auth.passwordResetSuccessDescription}
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Link href="/login" className="w-full">
              <Button className="w-full">
                {t.auth.signInButton}
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Форма ввода нового пароля
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>{t.auth.resetPassword}</CardTitle>
          <CardDescription>
            Введите новый пароль для вашего аккаунта
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.auth.newPassword}</FormLabel>
                    <FormControl>
                      <PasswordInput
                        placeholder="Минимум 8 символов"
                        autoComplete="new-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.auth.confirmNewPassword}</FormLabel>
                    <FormControl>
                      <PasswordInput
                        placeholder="Повторите пароль"
                        autoComplete="new-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t.auth.resetPassword}
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter>
          <Link href="/login" className="w-full">
            <Button variant="ghost" className="w-full">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t.auth.backToLogin}
            </Button>
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}