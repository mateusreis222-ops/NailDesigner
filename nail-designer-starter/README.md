# Jéssica Souza Nail Designer

Aplicação responsiva de serviços e agendamentos, com áreas distintas para clientes e para a profissional. Usa Supabase para autenticação, catálogo, disponibilidade, reservas e registros financeiros.

## O que já está disponível

- Página inicial com apresentação do estúdio, chamada para agendamento, navegação para serviços e seção sobre.
- Cadastro de cliente por nome, e-mail, senha e telefone opcional; login e persistência de sessão pelo Supabase Auth.
- Perfil criado automaticamente no cadastro com papel de cliente. O painel `/admin` só abre para uma conta explicitamente promovida a proprietária.
- Catálogo público de serviços ativos com descrição, preço e duração.
- Agendamento autenticado: seleção de serviço, data e horário consultado no banco; a reserva é criada no servidor com o preço e o sinal recalculados e proteção contra concorrência.
- Área `/minha-conta` com histórico, dados de Pix, solicitação de cancelamento e links para pedir remarcação ou falar com a profissional.
- Painel `/admin` para consultar agenda e clientes, cadastrar/editar/publicar serviços, alterar horários semanais, remarcar/cancelar atendimentos, atualizar status e gerenciar dados de Pix e contato.
- Financeiro para confirmar manualmente o recebimento de Pix e registrar reembolsos feitos fora do aplicativo, com trilha de auditoria.
- WhatsApp manual: abre uma conversa com texto pré-preenchido para lembretes, dúvidas ou pedidos de remarcação; a pessoa precisa revisar e enviar a mensagem.
- Sinal padrão de 50% e reserva pendente por 30 minutos, configuráveis pela proprietária. O horário só é confirmado após confirmação manual do Pix.
- Layout adaptável para telas menores e maiores.
- Navegação entre as rotas `/`, `/servicos`, `/agendar` e `/admin`.

## Limites importantes

- O aplicativo não gera cobrança Pix, QR Code, comprovante ou confirmação bancária automática. A cliente transfere para a chave configurada; a profissional confirma o recebimento.
- Registrar um reembolso não transfere dinheiro. A devolução deve ser feita fora do aplicativo antes de registrar o valor.
- WhatsApp não é enviado automaticamente nem há agendamento de lembretes. Os links abrem o WhatsApp para envio manual.
- Decisões fora do prazo de cancelamento são feitas pela profissional. Estorno, crédito ou retenção são registrados manualmente; nenhuma retenção é automatizada.
- O primeiro perfil de proprietária precisa ser promovido manualmente no SQL Editor do Supabase. O cadastro público nunca permite escolher o papel de proprietária.

## Modelo de dados planejado

A migration `supabase/migrations/202610310001_initial_schema.sql` define a base inicial para:

- Negócios e perfis com papéis de proprietária e cliente.
- Serviços com descrição, preço, duração, imagem e estado ativo.
- Horários de funcionamento e períodos bloqueados.
- Agendamentos com status, valores registrados no momento da reserva e proteção contra sobreposição de horários ativos.
- Pagamentos, notificações e registros de auditoria.

As migrations habilitam RLS e incluem RPCs com validação de disponibilidade e autorização. A segunda migration adiciona criação automática do perfil, regras de proprietária, configuração do negócio, reserva, cancelamento, remarcação e operações manuais de pagamento. O padrão de cancelamento sem custo é 24 horas; decisões fora do prazo são feitas pela profissional.

## Tecnologias

- React 19, TypeScript e Vite.
- Tailwind CSS 4 e CSS da aplicação.
- React Router para navegação.
- Supabase JS para banco e autenticação.
- Lucide React para ícones.

## Executar localmente

Requisitos: Node.js LTS e npm.

```bash
npm install
cp .env.example .env
npm run dev
```

Se usar Supabase, configure no `.env` a URL do projeto e a chave pública (`anon`/publishable) nas variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Sem elas, a aplicação continua inicializando, mas não há integração de dados.

O `.env` é local e ignorado pelo Git. Use somente uma chave pública `anon`/publishable no frontend; nunca coloque `service_role`, token de provedor ou senha de banco em variáveis `VITE_*`.

Comandos disponíveis:

```bash
npm run typecheck
npm run build
npm run preview
```

## Configurar o banco Supabase

Com o Supabase CLI instalado e um projeto criado:

```bash
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
```

## Promover a conta da profissional

Depois de aplicar as migrations e criar a conta pela tela `/cadastro`, execute no SQL Editor do projeto, substituindo o e-mail:

```sql
update public.profiles
set role = 'owner',
		business_id = (select id from public.businesses order by created_at limit 1)
where id = (select id from auth.users where email = 'seu-email@exemplo.com')
	and role = 'customer';
```

Entre novamente para carregar o papel atualizado. A proprietária poderá então cadastrar serviços, definir horários, chave Pix, telefone de WhatsApp e percentual do sinal no painel.

## Antes de produção

- Aplicar as duas migrations no projeto apontado por `.env`; a consulta atual indica que `public.services` ainda não existe nesse banco.
- Configurar URLs de redirecionamento e confirmação de e-mail no Supabase Auth.
- Rever RLS, privacidade/LGPD, backups, logs e retenção.
- Se necessário, integrar um provedor Pix com webhook validado no servidor e uma API autorizada do WhatsApp.

Nunca exponha a chave `service_role` nem segredos no frontend. A chave pública é destinada ao cliente e deve ser protegida pelas políticas RLS e pela validação de operações no servidor.
