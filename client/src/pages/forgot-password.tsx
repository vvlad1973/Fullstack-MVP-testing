import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Mail, ArrowLeft, CheckCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const forgotPasswordSchema = z.object({
  email: z.string().min(1, t.users.emailRequired).email(t.users.invalidEmail),
});

type ForgotPasswordData = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [emailConfirmed, setEmailConfirmed] = useState(false);

  // Получаем email из URL параметров
  const urlParams = new URLSearchParams(window.location.search);
  const emailFromUrl = urlParams.get("email") || "";

  const form = useForm<ForgotPasswordData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: emailFromUrl,
    },
  });

  // Проверяем email при загрузке если он передан
  useEffect(() => {
    if (emailFromUrl) {
      checkEmail(emailFromUrl);
    }
  }, []);

  const checkEmail = async (email: string) => {
    if (!email || !email.includes("@")) return;
    
    setIsChecking(true);
    try {
      const res = await fetch("/api/auth/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      
      if (data.exists && data.maskedEmail) {
        setMaskedEmail(data.maskedEmail);
      } else {
        setMaskedEmail(null);
      }
    } catch (error) {
      setMaskedEmail(null);
    } finally {
      setIsChecking(false);
    }
  };

  // Проверяем email при изменении с debounce
  const handleEmailBlur = () => {
    const email = form.getValues("email");
    if (email && email.includes("@")) {
      checkEmail(email);
    }
  };

  const onSubmit = async (data: ForgotPasswordData) => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email }),
      });

      if (res.status === 429) {
        toast({
          variant: "destructive",
          title: t.auth.tooManyRequests,
          description: t.auth.tooManyRequestsDescription,
        });
        return;
      }

      const result = await res.json();
      if (result.maskedEmail) {
        setMaskedEmail(result.maskedEmail);
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        {isSuccess ? (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <CardTitle>{t.auth.resetLinkSent}</CardTitle>
              <CardDescription className="mt-2">
                {maskedEmail ? (
                  <>Ссылка для сброса пароля отправлена на <strong>{maskedEmail}</strong></>
                ) : (
                  t.auth.resetLinkSentDescription
                )}
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Link href="/login" className="w-full">
                <Button variant="outline" className="w-full">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  {t.auth.backToLogin}
                </Button>
              </Link>
            </CardFooter>
          </>
        ) : (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Mail className="h-6 w-6 text-primary" />
              </div>
              <CardTitle>{t.auth.resetPassword}</CardTitle>
              <CardDescription>
                {maskedEmail ? (
                  <>Отправить ссылку для сброса пароля на <strong>{maskedEmail}</strong>?</>
                ) : (
                  t.auth.resetPasswordDescription
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t.auth.email}</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder={t.auth.emailPlaceholder}
                            autoComplete="email"
                            {...field}
                            onBlur={(e) => {
                              field.onBlur();
                              handleEmailBlur();
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={isSubmitting || isChecking}>
                    {(isSubmitting || isChecking) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {maskedEmail ? "Отправить ссылку" : t.auth.sendResetLink}
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
          </>
        )}
      </Card>
    </div>
  );
}