# Fatura de cartão detalhada

## O que será criado
- Adicionar “Fatura de cartão” como opção ao cadastrar uma despesa.
- Permitir informar nome do cartão, valor da fatura, data e categoria.
- Incluir várias compras na mesma fatura, cada uma com descrição, valor e data.
- Mostrar a soma das compras e a diferença para o valor informado da fatura em tempo real.
- Indicar claramente quando a fatura bate ou quando ainda há diferença.
- Exibir as faturas nos movimentos e permitir abrir o detalhamento das compras.

## Dados e segurança
- Criar uma tabela de compras vinculadas ao lançamento da fatura.
- Cada pessoa poderá visualizar e alterar apenas as próprias compras.
- A fatura continuará sendo uma despesa única nos totais e relatórios, evitando somar as compras duas vezes.

## Validação
- Salvar a fatura e todas as compras juntas; se alguma etapa falhar, desfazer o cadastro incompleto.
- Conferir o fluxo no computador e no celular, incluindo soma correta, diferença e detalhamento.
