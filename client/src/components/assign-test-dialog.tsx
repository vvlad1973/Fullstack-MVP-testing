import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  UsersRound,
  Trash2,
  Loader2,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { t } from "@/lib/i18n";

interface User {
  id: string;
  email: string;
  name: string | null;
  role: "author" | "learner";
  status: string;
}

interface Group {
  id: string;
  name: string;
  description: string | null;
  userCount: number;
}

interface Assignment {
  id: string;
  testId: string;
  userId: string | null;
  groupId: string | null;
  dueDate: string | null;
  assignedAt: string;
  user?: User | null;
  group?: Group | null;
}

interface AssignTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testId: string;
  testTitle: string;
}

export function AssignTestDialog({
  open,
  onOpenChange,
  testId,
  testTitle,
}: AssignTestDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"current" | "users" | "groups">("current");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState<string>("");

  // Fetch current assignments
  const { data: assignments = [], isLoading: assignmentsLoading } = useQuery<Assignment[]>({
    queryKey: [`/api/tests/${testId}/assignments`],
    enabled: open,
  });

  // Fetch all users
  const { data: allUsers = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
    enabled: open,
  });

  // Fetch all groups
  const { data: allGroups = [] } = useQuery<Group[]>({
    queryKey: ["/api/groups"],
    enabled: open,
  });

  // Assign mutation
  const assignMutation = useMutation({
    mutationFn: async (data: { userIds?: string[]; groupIds?: string[]; dueDate?: string }) => {
      const res = await fetch(`/api/tests/${testId}/assignments/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to assign");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tests/${testId}/assignments`] });
      setSelectedUserIds([]);
      setSelectedGroupIds([]);
      setDueDate("");
      setActiveTab("current");
      toast({ title: t.assignments.assigned, description: t.assignments.assignedDescription });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.assignments.failedToAssign });
    },
  });

  // Remove assignment mutation
  const removeMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      const res = await fetch(`/api/assignments/${assignmentId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to remove");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tests/${testId}/assignments`] });
      toast({ title: t.assignments.removed, description: t.assignments.removedDescription });
    },
    onError: () => {
      toast({ variant: "destructive", title: t.common.error, description: t.assignments.failedToRemove });
    },
  });

  const handleAssignUsers = () => {
    if (selectedUserIds.length === 0) return;
    assignMutation.mutate({
      userIds: selectedUserIds,
      dueDate: dueDate || undefined,
    });
  };

  const handleAssignGroups = () => {
    if (selectedGroupIds.length === 0) return;
    assignMutation.mutate({
      groupIds: selectedGroupIds,
      dueDate: dueDate || undefined,
    });
  };

  // Filter out already assigned users
  const assignedUserIds = assignments
    .filter((a) => a.userId)
    .map((a) => a.userId!);
  const availableUsers = allUsers.filter(
    (u) => !assignedUserIds.includes(u.id) && u.role === "learner"
  );

  // Filter out already assigned groups
  const assignedGroupIds = assignments
    .filter((a) => a.groupId)
    .map((a) => a.groupId!);
  const availableGroups = allGroups.filter(
    (g) => !assignedGroupIds.includes(g.id)
  );

  const formatDate = (date: string | null) => {
    if (!date) return "—";
    return new Date(date).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t.assignments.manageAssignments}</DialogTitle>
          <DialogDescription>{testTitle}</DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="current">
              {t.assignments.assignedTo} ({assignments.length})
            </TabsTrigger>
            <TabsTrigger value="users">
              <Users className="h-4 w-4 mr-2" />
              {t.assignments.users}
            </TabsTrigger>
            <TabsTrigger value="groups">
              <UsersRound className="h-4 w-4 mr-2" />
              {t.assignments.groups}
            </TabsTrigger>
          </TabsList>

          {/* Current Assignments Tab */}
          <TabsContent value="current" className="flex-1 overflow-auto mt-4">
            {assignmentsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : assignments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>{t.assignments.noAssignments}</p>
                <p className="text-sm">{t.assignments.noAssignmentsDescription}</p>
              </div>
            ) : (
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.assignments.assignedTo}</TableHead>
                      <TableHead>Тип</TableHead>
                      <TableHead>{t.assignments.dueDate}</TableHead>
                      <TableHead>{t.assignments.assignedAt}</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignments.map((assignment) => (
                      <TableRow key={assignment.id}>
                        <TableCell>
                          {assignment.user ? (
                            <div>
                              <p className="font-medium">{assignment.user.email}</p>
                              {assignment.user.name && (
                                <p className="text-sm text-muted-foreground">{assignment.user.name}</p>
                              )}
                            </div>
                          ) : assignment.group ? (
                            <div>
                              <p className="font-medium">{assignment.group.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {assignment.group.userCount} чел.
                              </p>
                            </div>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {assignment.user ? (
                              <><Users className="h-3 w-3 mr-1" /> Пользователь</>
                            ) : (
                              <><UsersRound className="h-3 w-3 mr-1" /> Группа</>
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {assignment.dueDate ? (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatDate(assignment.dueDate)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">{t.assignments.noDueDate}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatDate(assignment.assignedAt)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeMutation.mutate(assignment.id)}
                            disabled={removeMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Assign to Users Tab */}
          <TabsContent value="users" className="flex-1 overflow-auto mt-4 space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Label htmlFor="due-date-users">{t.assignments.dueDate}</Label>
                <Input
                  id="due-date-users"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div className="pt-6">
                <Button
                  onClick={handleAssignUsers}
                  disabled={selectedUserIds.length === 0 || assignMutation.isPending}
                >
                  {assignMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {t.assignments.assign} ({selectedUserIds.length})
                </Button>
              </div>
            </div>

            {availableUsers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>Все пользователи уже назначены</p>
              </div>
            ) : (
              <div className="border rounded-lg max-h-[300px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">
                        <Checkbox
                          checked={selectedUserIds.length === availableUsers.length && availableUsers.length > 0}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedUserIds(availableUsers.map((u) => u.id));
                            } else {
                              setSelectedUserIds([]);
                            }
                          }}
                        />
                      </TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>{t.users.name}</TableHead>
                      <TableHead>{t.users.status}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {availableUsers.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedUserIds.includes(user.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedUserIds([...selectedUserIds, user.id]);
                              } else {
                                setSelectedUserIds(selectedUserIds.filter((id) => id !== user.id));
                              }
                            }}
                          />
                        </TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>{user.name || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={user.status === "active" ? "default" : "secondary"}>
                            {user.status === "active" ? t.users.active : t.users.pending}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Assign to Groups Tab */}
          <TabsContent value="groups" className="flex-1 overflow-auto mt-4 space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Label htmlFor="due-date-groups">{t.assignments.dueDate}</Label>
                <Input
                  id="due-date-groups"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div className="pt-6">
                <Button
                  onClick={handleAssignGroups}
                  disabled={selectedGroupIds.length === 0 || assignMutation.isPending}
                >
                  {assignMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {t.assignments.assign} ({selectedGroupIds.length})
                </Button>
              </div>
            </div>

            {availableGroups.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>Все группы уже назначены</p>
              </div>
            ) : (
              <div className="border rounded-lg max-h-[300px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">
                        <Checkbox
                          checked={selectedGroupIds.length === availableGroups.length && availableGroups.length > 0}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedGroupIds(availableGroups.map((g) => g.id));
                            } else {
                              setSelectedGroupIds([]);
                            }
                          }}
                        />
                      </TableHead>
                      <TableHead>{t.groups.name}</TableHead>
                      <TableHead>{t.groups.groupDescription}</TableHead>
                      <TableHead>{t.groups.membersCount}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {availableGroups.map((group) => (
                      <TableRow key={group.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedGroupIds.includes(group.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedGroupIds([...selectedGroupIds, group.id]);
                              } else {
                                setSelectedGroupIds(selectedGroupIds.filter((id) => id !== group.id));
                              }
                            }}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{group.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {group.description || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{group.userCount} чел.</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}